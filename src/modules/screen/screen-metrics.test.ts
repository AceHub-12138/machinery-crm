import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ prisma: {
  customer: { count: vi.fn() }, contract: { count: vi.fn(), aggregate: vi.fn(), findMany: vi.fn() },
  contractPayment: { aggregate: vi.fn() }, shipment: { count: vi.fn() },
} }));
import { prisma } from "@/lib/db";
import { beijingPeriod } from "./beijing-period";
import { readScreenMetrics } from "./screen-metrics";

type Row = Record<string, unknown>;
// 小型数据集查询器独立执行 Prisma 条件，让状态、币种和边界错误实际改变测试金额。
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected === null || typeof expected !== "object") return actual === expected;
    const condition = expected as Row;
    if ("in" in condition) return (condition.in as unknown[]).includes(actual);
    if ("none" in condition) return !(actual as Row[]).some(item => matches(item, condition.none as Row));
    if ("not" in condition) return actual !== condition.not;
    if ("gte" in condition || "lt" in condition) {
      if (!(actual instanceof Date)) return false;
      return (!(condition.gte instanceof Date) || actual >= condition.gte) && (!(condition.lt instanceof Date) || actual < condition.lt);
    }
    return matches(actual as Row, condition);
  });
}
const customer = { deletedAt: null, status: "WON", nextFollowDate: new Date("2026-10-01Z"), createdAt: new Date("2026-09-30T18:00Z") };
const makeContract = (id: string, status: string, amount: number, paid: number, due: string, currency = "CNY", created = "2026-09-30T18:00Z"): Row => ({
  id, deletedAt: null, customer, contractStatus: status, currency, amount, paidAmount: paid, unpaidAmount: amount - paid,
  createdAt: new Date(created), estimatedShipmentDate: new Date(due), shipments: [], paymentStatus: paid ? "PARTIAL_PAID" : "UNPAID",
});
const contracts = [
  makeContract("new", "SIGNED", 100000, 20000, "2026-10-01Z"),
  makeContract("complete", "COMPLETED", 200000, 50000, "2026-10-02Z"),
  makeContract("archive", "ARCHIVED", 300000, 100000, "2026-10-03Z"),
  makeContract("draft", "DRAFT", 900000, 0, "2026-10-01Z"),
  makeContract("cancel", "CANCELLED", 400000, 40000, "2026-10-01Z"),
  makeContract("foreign", "SIGNED", 700000, 0, "2026-10-04Z", "USD"),
  makeContract("old", "SIGNED", 100000, 90000, "2026-09-30Z", "CNY", "2026-08-01T00:00Z"),
];
const payment = (contract: Row, amount: number, date = "2026-10-01Z", status = "ACTIVE"): Row => ({ contract, amount, paymentDate: new Date(date), status });
const receipts = [payment(contracts[6], 150000), payment(contracts[4], 40000), payment(contracts[0], 20000),
  payment(contracts[0], 999999, "2026-10-01Z", "VOIDED"), payment(contracts[0], 888888, "2026-09-30Z"), payment(contracts[5], 700000)];
const shipments = [
  { contract: contracts[0], quantity: 2, shipmentDate: new Date("2026-10-01Z"), shipmentStatus: "PARTIAL_SHIPPED" },
  { contract: contracts[0], quantity: 3, shipmentDate: new Date("2026-10-01Z"), shipmentStatus: "SHIPPED" },
  { contract: contracts[0], quantity: 5, shipmentDate: new Date("2026-10-01Z"), shipmentStatus: "NOT_SHIPPED" },
];
function sum(rows: Row[], fields: Row) {
  return { _sum: Object.fromEntries(Object.keys(fields).map(key => [key, rows.reduce((n, row) => n + Number(row[key]), 0)])) };
}
beforeEach(() => {
  vi.resetAllMocks();
  const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
  mock(prisma.customer.count).mockImplementation(({ where }: { where: Row }) => [customer, { ...customer, deletedAt: new Date() }].filter(row => matches(row, where)).length);
  mock(prisma.contract.count).mockImplementation(({ where }: { where: Row }) => contracts.filter(row => matches(row, where)).length);
  mock(prisma.contract.aggregate).mockImplementation(({ where, _sum }: { where: Row; _sum: Row }) => sum(contracts.filter(row => matches(row, where)), _sum));
  mock(prisma.contract.findMany).mockImplementation(({ where, take }: { where: Row; take: number }) => contracts.filter(row => matches(row, where)).slice(0, take));
  mock(prisma.contractPayment.aggregate).mockImplementation(({ where, _sum }: { where: Row; _sum: Row }) => sum(receipts.filter(row => matches(row, where)), _sum));
  mock(prisma.shipment.count).mockImplementation(({ where }: { where: Row }) => shipments.filter(row => matches(row, where)).length);
});
describe("北京时间与固定公开口径", () => {
  it("北京月初 02:00 使用北京零点时间戳和独立 DATE 零点", () => {
    const p = beijingPeriod(new Date("2026-09-30T18:00:00Z"));
    expect(p.label).toBe("2026年10月");
    expect(p.start.toISOString()).toBe("2026-09-30T16:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-10-01T16:00:00.000Z");
    expect(p.dateStart.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(p.dateSevenDays.toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });
  it("合同数与金额同为人民币、本期仅有效、累计含归档、回款含老合同和取消合同", async () => {
    const p = await readScreenMetrics(new Date("2026-09-30T18:00:00Z"));
    expect(p.stats).toMatchObject({ totalCustomers: 1, todayFollowUp: 1, periodNewContracts: 2,
      periodContractAmount: 300000, periodPaidAmount: 210000, periodUnpaidAmount: 230000,
      totalContractAmount: 700000, totalPaidAmount: 260000, totalUnpaidAmount: 440000,
      unpaidContracts: 0, partialPaidContracts: 3, periodShipments: 2, todayShipmentDue: 1, sevenDayShipmentDue: 2, overdueShipmentDue: 1 });
    expect(Number(p.stats.periodPaidAmount) + Number(p.stats.periodUnpaidAmount)).not.toBe(p.stats.periodContractAmount);
    expect(p.shipmentReminders.today).toHaveLength(1);
    expect(p.shipmentReminders.sevenDays).toHaveLength(2);
    expect(p.shipmentReminders.overdue).toHaveLength(1);
  });
  it("外币的未回款与部分回款合同不计入公开合同数", async () => {
    const foreignPartial = makeContract("euro", "SIGNED", 800000, 200000, "2026-10-05Z", "EUR");
    contracts.push(foreignPartial);
    try {
      const p = await readScreenMetrics(new Date("2026-09-30T18:00:00Z"));
      expect(p.stats).toMatchObject({ periodNewContracts: 2, periodContractAmount: 300000, unpaidContracts: 0, partialPaidContracts: 3 });
    } finally { contracts.pop(); }
  });
  it("软删除合同与客户不进入合同额、实收和发货，北京次日边界不计本期", async () => {
    const extra = [
      { ...makeContract("deleted-contract", "SIGNED", 999999, 1, "2026-10-01Z"), deletedAt: new Date() },
      { ...makeContract("deleted-customer", "SIGNED", 999999, 1, "2026-10-01Z"), customer: { ...customer, deletedAt: new Date() } },
      { ...makeContract("future", "SIGNED", 999999, 1, "2026-10-01Z", "CNY", "2026-10-01T16:00Z"), estimatedShipmentDate: null },
    ];
    contracts.push(...extra); receipts.push(payment(extra[0], 999999), payment(extra[1], 999999), payment(contracts[0], 999999, "2026-10-02Z"));
    shipments.push({ contract: extra[0], quantity: 99, shipmentDate: new Date("2026-10-01Z"), shipmentStatus: "SHIPPED" });
    try {
      const p = await readScreenMetrics(new Date("2026-09-30T18:00Z"));
      expect(p.stats).toMatchObject({ periodContractAmount: 300000, periodPaidAmount: 210000, periodNewContracts: 2, periodShipments: 2 });
      expect(p.shipmentReminders.today).toHaveLength(1);
    } finally { contracts.splice(-3); receipts.splice(-3); shipments.pop(); }
  });
  it("次日日期恰在排除边界，月底全天与未来六日均按业务日划分", async () => {
    const p = beijingPeriod(new Date("2026-10-31T15:59:59Z"));
    expect(p.endDate).toBe("2026-10-31");
    expect(p.dateTomorrow.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    const q = await readScreenMetrics(new Date("2026-10-01T16:00:00Z"));
    expect(q.stats.todayShipmentDue).toBe(1);
    expect(q.stats.sevenDayShipmentDue).toBe(1);
    expect(q.stats.overdueShipmentDue).toBe(2);
  });
});
