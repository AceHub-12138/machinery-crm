import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/permissions";
import { DomainError } from "@/modules/shared/domain-error";
import { getCrmDashboard } from "@/modules/crm/dashboard/service";
import { listSalesTargets, parseSalesTargetPeriod } from "@/modules/crm/sales-targets/service";
import { normalizeSalesScreenConfig, SALES_SCREEN_SETTING_KEY, type SalesScreenConfig } from "./config";
import { isValidPublicIdFormat, normalizeSalesScreenShareState, SALES_SCREEN_SHARE_SETTING_KEY } from "./share";
import { transformToPublicPayload } from "./display-payload";
import { isValidLocation, resolveLocation } from "./location";
import type { PublicSalesScreenPayload } from "./public-types";
import type {
  SalesScreenSourceData,
  SalesScreenReminderSource,
  SalesScreenRouteSource,
  AmountInput,
} from "./source-data";

// 服务器内部全公司读取专用身份：仅用于服务层口径（canSeeAllData），
// 不产生登录会话，也绝不随响应序列化输出到浏览器。
const COMPANY_READER: SessionUser = {
  id: "system:public-sales-screen",
  role: "SUPER_ADMIN",
  region: "",
  viewScope: "ALL",
  territories: [],
  name: "展厅大屏系统读取",
  email: "",
};

// 与工作台「可发货/已发货」路线口径一致
const DELIVERED_SHIPMENT_STATUS = ["SHIPPED", "PARTIAL_SHIPPED"] as const;
const DELIVERED_SHIPMENT_STATUS_WHERE = { shipmentStatus: { in: [...DELIVERED_SHIPMENT_STATUS] } };
const COMPANY_CONTRACT_SCOPE = { deletedAt: null, customer: { deletedAt: null } };

// 所有关卡失败统一表现为「大屏不可用」，不泄露失败原因差异
function unavailable(): never {
  throw new DomainError("大屏不可用", 404);
}

/** 验证自由文本省市并映射为标准行政区划；省份无法验证时返回 null */
function resolveVerifiedLocation(rawProvince: unknown, rawCity: unknown): { province: string; city: string | null } | null {
  const province = resolveLocation(rawProvince)?.province;
  if (!province) return null;
  const candidateCity = typeof rawCity === "string" ? rawCity.trim() : "";
  const city = candidateCity && isValidLocation(province, candidateCity) ? candidateCity : null;
  return { province, city };
}

/** 全公司交付总量口径：显式全量字段，区别于列表样本 */
async function readDeliveryTotals(todayDue: number, sevenDayDue: number, overdueDue: number) {
  const where = { ...DELIVERED_SHIPMENT_STATUS_WHERE, contract: COMPANY_CONTRACT_SCOPE };
  const [shipmentCount, aggregate, provinces] = await Promise.all([
    prisma.shipment.count({ where }),
    prisma.shipment.aggregate({ where, _sum: { quantity: true } }),
    prisma.customer.findMany({
      where: {
        deletedAt: null,
        contracts: { some: { deletedAt: null, shipments: { some: DELIVERED_SHIPMENT_STATUS_WHERE } } },
      },
      select: { province: true },
      distinct: ["province"],
    }),
  ]);

  const regionCount = new Set(
    provinces
      .map((row) => resolveLocation(row.province)?.province)
      .filter((name): name is string => Boolean(name))
  ).size;

  return {
    shipmentCount,
    unitCount: aggregate._sum?.quantity ?? 0,
    regionCount,
    todayDue,
    sevenDayDue,
    overdueDue,
  };
}

/** 地图路线样本：剔除无法验证省级行政区的行，绝不携带客户身份字段 */
async function readRouteSamples(): Promise<SalesScreenRouteSource[]> {
  const rows = await prisma.shipment.findMany({
    where: { ...DELIVERED_SHIPMENT_STATUS_WHERE, contract: COMPANY_CONTRACT_SCOPE },
    orderBy: { shipmentDate: "desc" },
    take: 80,
    select: {
      shipmentDate: true,
      shipmentStatus: true,
      quantity: true,
      contract: {
        select: {
          contractNo: true,
          equipmentName: true,
          equipmentModel: true,
          customer: { select: { province: true, city: true } },
        },
      },
    },
  });

  const routes: SalesScreenRouteSource[] = [];
  for (const row of rows) {
    const location = resolveVerifiedLocation(row.contract.customer?.province, row.contract.customer?.city);
    if (!location) continue;
    routes.push({
      contractNo: row.contract.contractNo,
      equipmentName: row.contract.equipmentName,
      equipmentModel: row.contract.equipmentModel,
      shipmentDate: row.shipmentDate.toISOString(),
      shipmentStatus: row.shipmentStatus,
      quantity: row.quantity,
      province: location.province,
      city: location.city,
    });
  }
  return routes;
}

/** 交付提醒样本：复用工作台口径的合同行，仅补齐验证后的省市 */
async function readReminderSamples(
  groups: { today: Array<Record<string, unknown>>; sevenDays: Array<Record<string, unknown>>; overdue: Array<Record<string, unknown>> }
): Promise<{ today: SalesScreenReminderSource[]; sevenDays: SalesScreenReminderSource[]; overdue: SalesScreenReminderSource[] }> {
  const customerIds = [...new Set(
    Object.values(groups).flatMap((rows) => rows.map((row) => (row.customer as { id?: string } | undefined)?.id))
      .filter((id): id is string => Boolean(id))
  )];

  const locationById = new Map<string, { province: string; city: string | null }>();
  if (customerIds.length > 0) {
    const rows = await prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, province: true, city: true },
    });
    for (const row of rows) {
      const location = resolveVerifiedLocation(row.province, row.city);
      if (location) locationById.set(row.id, location);
    }
  }

  const mapGroup = (rows: Array<Record<string, unknown>>): SalesScreenReminderSource[] => {
    const samples: SalesScreenReminderSource[] = [];
    for (const row of rows) {
      const customerId = (row.customer as { id?: string } | undefined)?.id;
      const location = customerId ? locationById.get(customerId) : undefined;
      if (!location) continue;
      samples.push({
        contractNo: String(row.contractNo ?? ""),
        equipmentName: String(row.equipmentName ?? ""),
        equipmentModel: String(row.equipmentModel ?? ""),
        estimatedShipmentDate: (row.estimatedShipmentDate as Date).toISOString(),
        province: location.province,
        city: location.city,
      });
    }
    return samples;
  };

  return { today: mapGroup(groups.today), sevenDays: mapGroup(groups.sevenDays), overdue: mapGroup(groups.overdue) };
}

export async function getPublicSalesScreenPayload(
  publicId: string,
  options: { now?: () => Date } = {}
): Promise<PublicSalesScreenPayload> {
  // 第一关：格式错误的 publicId 在任何数据库/业务读取前拒绝
  if (!isValidPublicIdFormat(publicId)) unavailable();

  const now = options.now ?? (() => new Date());

  // 第二关：共享状态与大屏配置
  const [shareRow, configRow] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: SALES_SCREEN_SHARE_SETTING_KEY } }),
    prisma.systemSetting.findUnique({ where: { key: SALES_SCREEN_SETTING_KEY } }),
  ]);
  const share = normalizeSalesScreenShareState(shareRow?.value);
  const config: SalesScreenConfig = normalizeSalesScreenConfig(configRow?.value);

  if (!config.enabled) unavailable();
  // 撤销、未生成、轮换后的旧 ID 统一表现为不可用
  if (share.publicId === null || share.publicId !== publicId) unavailable();

  // 第三关：固定当前月、全公司口径读取；不接受任何查询过滤器。
  // 同一时钟贯穿目标周期与 dashboard 统计，避免跨月零点口径撕裂。
  const atRequest = now();
  const period = parseSalesTargetPeriod(new URLSearchParams(), atRequest);
  const [dashboard, targetList] = await Promise.all([
    getCrmDashboard(COMPANY_READER, new URLSearchParams(), atRequest),
    listSalesTargets(COMPANY_READER, period, "CONTRACT_AMOUNT"),
  ]);

  const stats = (dashboard.stats ?? {}) as Record<string, unknown>;
  const numberAt = (key: string): number => (typeof stats[key] === "number" && Number.isFinite(stats[key]) ? (stats[key] as number) : 0);
  const amountAt = (key: string): AmountInput => {
    const value = stats[key];
    if (typeof value === "number" || typeof value === "string") return value;
    if (value && typeof value === "object" && "toFixed" in value) return value as { toFixed: () => string };
    return 0;
  };

  const companyTarget = (targetList?.targets ?? []).find(
    (row) => row.salesUserId === null && row.metric === "CONTRACT_AMOUNT"
  );

  const [deliveryTotals, routes, reminders] = await Promise.all([
    readDeliveryTotals(numberAt("todayShipmentDue"), numberAt("sevenDayShipmentDue"), numberAt("overdueShipmentDue")),
    readRouteSamples(),
    readReminderSamples((dashboard.shipmentReminders ?? {}) as { today: Array<Record<string, unknown>>; sevenDays: Array<Record<string, unknown>>; overdue: Array<Record<string, unknown>> }),
  ]);

  const source: SalesScreenSourceData = {
    period: {
      label: period.label,
      startDate: String(dashboard.range?.startDate ?? period.start.toISOString().slice(0, 10)),
      endDate: String(dashboard.range?.endDate ?? ""),
    },
    kpis: {
      totalCustomers: numberAt("totalCustomers"),
      periodNewCustomers: numberAt("periodNewCustomers"),
      todayFollowUp: numberAt("todayFollowUp"),
      overdueFollowUp: numberAt("overdueFollowUp"),
      sevenDayFollowUp: numberAt("sevenDayFollowUp"),
      periodNewContracts: numberAt("periodNewContracts"),
      periodShipments: numberAt("periodShipments"),
      unpaidContracts: numberAt("unpaidContracts"),
      partialPaidContracts: numberAt("partialPaidContracts"),
    },
    amounts: {
      periodContractAmount: amountAt("periodContractAmount"),
      periodPaidAmount: amountAt("periodPaidAmount"),
      periodUnpaidAmount: amountAt("periodUnpaidAmount"),
      totalContractAmount: amountAt("totalContractAmount"),
      totalPaidAmount: amountAt("totalPaidAmount"),
      totalUnpaidAmount: amountAt("totalUnpaidAmount"),
    },
    target: companyTarget
      ? { targetAmount: String(companyTarget.amount), actualAmount: String(companyTarget.actualAmount ?? "0") }
      : null,
    deliveryTotals,
    routes,
    reminders,
  };

  // 真实数据必须先经过第 2 步纯转换模块（倍率、白名单投影、取样、比率重算）
  return transformToPublicPayload(source, config, { generatedAt: atRequest.toISOString() });
}
