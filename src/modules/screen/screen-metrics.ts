import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { beijingPeriod } from "./beijing-period";

/** 公开链路的固定全公司口径；不接受查询筛选，不改变后台工作台的筛选行为。 */
export async function readScreenMetrics(now: Date) {
  const period = beijingPeriod(now);
  const customer = { deletedAt: null };
  const scope = { deletedAt: null, customer };
  const effective: Prisma.ContractWhereInput = { ...scope, contractStatus: { in: ["SIGNED", "COMPLETED"] } };
  const cumulative: Prisma.ContractWhereInput = { ...scope, contractStatus: { in: ["SIGNED", "COMPLETED", "ARCHIVED"] } };
  // 本期仍沿用创建时间；DATE 列使用独立业务日边界。
  const current: Prisma.ContractWhereInput = { ...effective, createdAt: { gte: period.start, lt: period.end } };
  const due: Prisma.ContractWhereInput = {
    ...effective, estimatedShipmentDate: { not: null }, shipments: { none: { shipmentStatus: "SHIPPED" } },
  };
  const buckets = {
    today: { gte: period.dateToday, lt: period.dateTomorrow },
    sevenDays: { gte: period.dateTomorrow, lt: period.dateSevenDays },
    overdue: { lt: period.dateToday },
  };
  const dueWhere = (key: keyof typeof buckets): Prisma.ContractWhereInput => ({ ...due, estimatedShipmentDate: buckets[key] });
  const select = {
    contractNo: true, equipmentName: true, equipmentModel: true, estimatedShipmentDate: true,
    customer: { select: { province: true, city: true } },
  } as const;
  const [totalCustomers, periodNewCustomers, todayFollowUp, sevenDayFollowUp, overdueFollowUp,
    periodNewContracts, currentAmounts, totalAmounts, receipts, periodShipments, unpaidContracts,
    partialPaidContracts, todayDue, sevenDayDue, overdueDue, today, sevenDays, overdue] = await Promise.all([
    prisma.customer.count({ where: customer }),
    prisma.customer.count({ where: { ...customer, createdAt: { gte: period.start, lt: period.end } } }),
    // 成交客户仍可有跟进任务；不再排除 WON。
    prisma.customer.count({ where: { ...customer, nextFollowDate: buckets.today } }),
    prisma.customer.count({ where: { ...customer, nextFollowDate: buckets.sevenDays } }),
    prisma.customer.count({ where: { ...customer, nextFollowDate: buckets.overdue } }),
    prisma.contract.count({ where: current }),
    prisma.contract.aggregate({ where: { ...current, currency: "CNY" }, _sum: { amount: true, paidAmount: true, unpaidAmount: true } }),
    prisma.contract.aggregate({ where: { ...cumulative, currency: "CNY" }, _sum: { amount: true, paidAmount: true, unpaidAmount: true } }),
    // 有效实收包含老合同及取消合同，但不越过既有软删除边界；不折算外币。
    prisma.contractPayment.aggregate({ where: {
      status: "ACTIVE", paymentDate: { gte: period.dateStart, lt: period.dateTomorrow },
      contract: { ...scope, currency: "CNY" },
    }, _sum: { amount: true } }),
    prisma.shipment.count({ where: {
      shipmentDate: { gte: period.dateStart, lt: period.dateTomorrow },
      shipmentStatus: { in: ["SHIPPED", "PARTIAL_SHIPPED"] }, contract: scope,
    } }),
    prisma.contract.count({ where: { ...effective, paymentStatus: "UNPAID" } }),
    prisma.contract.count({ where: { ...effective, paymentStatus: "PARTIAL_PAID" } }),
    prisma.contract.count({ where: dueWhere("today") }),
    prisma.contract.count({ where: dueWhere("sevenDays") }),
    prisma.contract.count({ where: dueWhere("overdue") }),
    prisma.contract.findMany({ where: dueWhere("today"), orderBy: [{ estimatedShipmentDate: "asc" }, { id: "asc" }], take: 8, select }),
    prisma.contract.findMany({ where: dueWhere("sevenDays"), orderBy: [{ estimatedShipmentDate: "asc" }, { id: "asc" }], take: 8, select }),
    prisma.contract.findMany({ where: dueWhere("overdue"), orderBy: [{ estimatedShipmentDate: "asc" }, { id: "asc" }], take: 8, select }),
  ]);
  return {
    range: { startDate: period.startDate, endDate: period.endDate },
    stats: {
      totalCustomers, periodNewCustomers, todayFollowUp, sevenDayFollowUp, overdueFollowUp,
      periodNewContracts, periodShipments, unpaidContracts, partialPaidContracts,
      periodContractAmount: currentAmounts._sum.amount ?? 0,
      periodPaidAmount: receipts._sum.amount ?? 0,
      // 本期新合同自身欠款，不能减去包含老合同回款的本期实收。
      periodUnpaidAmount: currentAmounts._sum.unpaidAmount ?? 0,
      totalContractAmount: totalAmounts._sum.amount ?? 0,
      totalPaidAmount: totalAmounts._sum.paidAmount ?? 0,
      totalUnpaidAmount: totalAmounts._sum.unpaidAmount ?? 0,
      todayShipmentDue: todayDue, sevenDayShipmentDue: sevenDayDue, overdueShipmentDue: overdueDue,
    },
    shipmentReminders: { today, sevenDays, overdue },
  };
}
