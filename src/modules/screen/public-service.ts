import { prisma } from "@/lib/db";
import { DomainError } from "@/modules/shared/domain-error";
import { normalizeSalesScreenConfig, SALES_SCREEN_SETTING_KEY } from "./config";
import { isValidPublicIdFormat, normalizeSalesScreenShareState, SALES_SCREEN_SHARE_SETTING_KEY } from "./share";
import { transformToPublicPayload } from "./display-payload";
import { isValidLocation, resolveLocation } from "./location";
import { beijingPeriod } from "./beijing-period";
import { readScreenMetrics } from "./screen-metrics";
import type { PublicSalesScreenPayload } from "./public-types";
import type { SalesScreenSourceData, SalesScreenReminderSource, AmountInput } from "./source-data";

const DELIVERED_SHIPMENT_STATUS = ["SHIPPED", "PARTIAL_SHIPPED"] as const;
const COMPANY_CONTRACT_SCOPE = { deletedAt: null, customer: { deletedAt: null } };
function unavailable(): never { throw new DomainError("大屏不可用", 404); }

/** 同一次全量读取同时构造总数、省份聚合、待确认地区和样本，避免各查询口径分裂。 */
async function readDelivery() {
  const rows = await prisma.shipment.findMany({
    where: { shipmentStatus: { in: [...DELIVERED_SHIPMENT_STATUS] }, contract: COMPANY_CONTRACT_SCOPE },
    orderBy: [{ shipmentDate: "desc" }, { id: "asc" }],
    select: {
      shipmentDate: true, shipmentStatus: true, quantity: true,
      contract: { select: { contractNo: true, equipmentName: true, equipmentModel: true,
        customer: { select: { province: true, city: true } } } },
    },
  });
  const regions = new Map<string, { province: string; shipmentCount: number; unitCount: number }>();
  const unresolvedRegionTotals = { shipmentCount: 0, unitCount: 0 };
  let unitCount = 0;
  for (const row of rows) {
    unitCount += row.quantity;
    if (row.quantity < 0) console.warn("[screen] negative count", { field: "shipment.quantity", value: row.quantity });
    const province = resolveLocation(row.contract.customer?.province)?.province;
    if (!province) {
      unresolvedRegionTotals.shipmentCount += 1;
      unresolvedRegionTotals.unitCount += row.quantity;
      continue;
    }
    const bucket = regions.get(province) ?? { province, shipmentCount: 0, unitCount: 0 };
    bucket.shipmentCount += 1;
    bucket.unitCount += row.quantity;
    regions.set(province, bucket);
  }
  const routes = rows.map(row => {
    const province = resolveLocation(row.contract.customer?.province)?.province ?? "";
    const candidateCity = row.contract.customer?.city;
    const city = province && candidateCity && isValidLocation(province, candidateCity) ? candidateCity : null;
    return {
      contractNo: row.contract.contractNo, equipmentName: row.contract.equipmentName,
      equipmentModel: row.contract.equipmentModel, shipmentDate: row.shipmentDate.toISOString(),
      shipmentStatus: row.shipmentStatus, quantity: row.quantity, province, city,
    };
  });
  return {
    shipmentCount: rows.length, unitCount, regionCount: regions.size,
    regionUnits: [...regions.values()].sort((a, b) => b.unitCount - a.unitCount || a.province.localeCompare(b.province, "zh-CN")),
    unresolvedRegionTotals, routes,
    // milestones 只展示已整单发出的记录，计数与样本使用同一集合。
    milestonesTotal: rows.filter(row => row.shipmentStatus === "SHIPPED").length,
  };
}

function reminderSamples(groups: Awaited<ReturnType<typeof readScreenMetrics>>["shipmentReminders"]) {
  const convert = (rows: typeof groups.today): SalesScreenReminderSource[] => rows.flatMap(row => {
    const province = resolveLocation(row.customer?.province)?.province;
    if (!province || !row.estimatedShipmentDate) return [];
    const city = row.customer?.city && isValidLocation(province, row.customer.city) ? row.customer.city : null;
    return [{ contractNo: row.contractNo, equipmentName: row.equipmentName, equipmentModel: row.equipmentModel,
      estimatedShipmentDate: row.estimatedShipmentDate.toISOString(), province, city }];
  });
  return { today: convert(groups.today), sevenDays: convert(groups.sevenDays), overdue: convert(groups.overdue) };
}

export async function getPublicSalesScreenPayload(publicId: string, options: { now?: () => Date } = {}): Promise<PublicSalesScreenPayload> {
  if (!isValidPublicIdFormat(publicId)) unavailable();
  const [shareRow, configRow] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: SALES_SCREEN_SHARE_SETTING_KEY } }),
    prisma.systemSetting.findUnique({ where: { key: SALES_SCREEN_SETTING_KEY } }),
  ]);
  const share = normalizeSalesScreenShareState(shareRow?.value);
  const config = normalizeSalesScreenConfig(configRow?.value);
  if (!config.enabled || share.publicId === null || share.publicId !== publicId) unavailable();
  const atRequest = (options.now ?? (() => new Date()))();
  const period = beijingPeriod(atRequest);
  const [dashboard, companyTarget, delivery] = await Promise.all([
    readScreenMetrics(atRequest),
    // MySQL 可空唯一键不能保证公司目标唯一；只读最新一条，绝不在取数时清理历史行。
    prisma.salesTarget.findFirst({
      where: { periodType: "MONTH", periodYear: period.year, periodIndex: period.month, salesUserId: null, metric: "CONTRACT_AMOUNT" },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }], select: { amount: true },
    }),
    readDelivery(),
  ]);
  const stats = dashboard.stats as Record<string, unknown>;
  const numberAt = (key: string): number => typeof stats[key] === "number" && Number.isFinite(stats[key]) ? stats[key] as number : 0;
  const amountAt = (key: string): AmountInput => {
    const value = stats[key];
    if (typeof value === "number" || typeof value === "string") return value;
    if (value && typeof value === "object" && "toFixed" in value) return value as { toFixed: () => string };
    return 0;
  };
  const source: SalesScreenSourceData = {
    period: { label: period.label, startDate: period.startDate, endDate: period.endDate },
    kpis: {
      totalCustomers: numberAt("totalCustomers"), periodNewCustomers: numberAt("periodNewCustomers"),
      todayFollowUp: numberAt("todayFollowUp"), overdueFollowUp: numberAt("overdueFollowUp"), sevenDayFollowUp: numberAt("sevenDayFollowUp"),
      periodNewContracts: numberAt("periodNewContracts"), periodShipments: numberAt("periodShipments"),
      unpaidContracts: numberAt("unpaidContracts"), partialPaidContracts: numberAt("partialPaidContracts"),
    },
    amounts: {
      periodContractAmount: amountAt("periodContractAmount"), periodPaidAmount: amountAt("periodPaidAmount"), periodUnpaidAmount: amountAt("periodUnpaidAmount"),
      totalContractAmount: amountAt("totalContractAmount"), totalPaidAmount: amountAt("totalPaidAmount"), totalUnpaidAmount: amountAt("totalUnpaidAmount"),
    },
    target: companyTarget ? { targetAmount: companyTarget.amount, actualAmount: amountAt("periodContractAmount") } : null,
    deliveryTotals: { shipmentCount: delivery.shipmentCount, unitCount: delivery.unitCount, regionCount: delivery.regionCount,
      todayDue: numberAt("todayShipmentDue"), sevenDayDue: numberAt("sevenDayShipmentDue"), overdueDue: numberAt("overdueShipmentDue") },
    regionUnits: delivery.regionUnits, unresolvedRegionTotals: delivery.unresolvedRegionTotals,
    milestonesTotal: delivery.milestonesTotal, routes: delivery.routes,
    reminders: reminderSamples(dashboard.shipmentReminders),
  };
  for (const [key, value] of Object.entries(source.kpis)) {
    if (value < 0) console.warn("[screen] negative count", { field: key, value });
  }
  for (const [key, value] of Object.entries(source.deliveryTotals)) {
    if (value < 0) console.warn("[screen] negative count", { field: key, value });
  }
  return transformToPublicPayload(source, config, { generatedAt: atRequest.toISOString() });
}
