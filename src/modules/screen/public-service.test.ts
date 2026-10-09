import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ prisma: {
  systemSetting: { findUnique: vi.fn() }, shipment: { findMany: vi.fn() }, salesTarget: { findFirst: vi.fn() },
} }));
vi.mock("./screen-metrics", () => ({ readScreenMetrics: vi.fn() }));
import { prisma } from "@/lib/db";
import { readScreenMetrics } from "./screen-metrics";
import { getPublicSalesScreenPayload } from "./public-service";
import { DEFAULT_SALES_SCREEN_CONFIG } from "./config";
const id = "a".repeat(43);
const at = new Date("2026-09-30T18:00:00Z"); // 北京 10 月 1 日 02:00
const stats = {
  totalCustomers: 18, periodNewCustomers: 4, todayFollowUp: 3, overdueFollowUp: 2, sevenDayFollowUp: 5,
  periodNewContracts: 6, periodContractAmount: 100000, periodPaidAmount: 150000, periodUnpaidAmount: 80000,
  periodShipments: 7, totalContractAmount: 1000000, totalPaidAmount: 400000, totalUnpaidAmount: -100,
  unpaidContracts: 2, partialPaidContracts: 3, todayShipmentDue: 1, sevenDayShipmentDue: 4, overdueShipmentDue: 30,
};
function row(province: string, quantity = 1, shipmentStatus = "SHIPPED") {
  return { shipmentDate: new Date("2026-09-20T00:00:00Z"), shipmentStatus, quantity,
    contract: { contractNo: "PRIVATE-123456", equipmentName: "数控插床", equipmentModel: "BK5030",
      customer: { province, city: null, companyName: "secret customer" } } };
}
beforeEach(() => {
  vi.resetAllMocks();
  (prisma.systemSetting.findUnique as ReturnType<typeof vi.fn>).mockImplementation(async (args: { where: { key: string } }) => ({ value: args.where.key === "salesScreenShare"
    ? { version: 1, publicId: id, createdAt: "2026-09-01T00:00:00.000Z", rotatedAt: null, revokedAt: null } : { ...DEFAULT_SALES_SCREEN_CONFIG, enabled: true,
      multipliers: { amount: 3, customerCount: 3, contractCount: 6, shipmentCount: 2 } } }) as never);
  vi.mocked(prisma.shipment.findMany).mockResolvedValue([row("山东省", 2, "PARTIAL_SHIPPED"), row("山东省", 3), row("bad province", 4)] as never);
  vi.mocked(prisma.salesTarget.findFirst).mockResolvedValue({ amount: "200000" } as never);
  vi.mocked(readScreenMetrics).mockResolvedValue({ range: { startDate: "2026-10-01", endDate: "2026-10-01" }, stats,
    shipmentReminders: { today: [], sevenDays: [], overdue: [] } } as never);
});
describe("公开大屏取数入口", () => {
  it("格式错误在任何数据库读取前拒绝", async () => {
    for (const bad of ["", "short", "../etc/passwd", undefined, null, 123]) {
      await expect(getPublicSalesScreenPayload(bad as string)).rejects.toMatchObject({ message: "大屏不可用", status: 404 });
    }
    expect(prisma.systemSetting.findUnique).not.toHaveBeenCalled();
  });
  it.each(["disabled", "revoked", "old-link"])("%s 不读取业务数据", async mode => {
    (prisma.systemSetting.findUnique as ReturnType<typeof vi.fn>).mockImplementation(async (args: { where: { key: string } }) => ({ value: args.where.key === "salesScreenShare"
      ? { version: 1, publicId: mode === "revoked" ? null : mode === "old-link" ? "b".repeat(43) : id }
      : { ...DEFAULT_SALES_SCREEN_CONFIG, enabled: mode !== "disabled" } }) as never);
    await expect(getPublicSalesScreenPayload(id)).rejects.toMatchObject({ status: 404 });
    expect(readScreenMetrics).not.toHaveBeenCalled();
    expect(prisma.shipment.findMany).not.toHaveBeenCalled();
    expect(prisma.salesTarget.findFirst).not.toHaveBeenCalled();
  });
  it("按北京月及固定公司目标读取，实际完成始终与本期合同额同源", async () => {
    const p = await getPublicSalesScreenPayload(id, { now: () => at });
    expect(readScreenMetrics).toHaveBeenCalledWith(at);
    expect(prisma.salesTarget.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { periodType: "MONTH", periodYear: 2026, periodIndex: 10, salesUserId: null, metric: "CONTRACT_AMOUNT" },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    }));
    expect(p.period).toEqual({ label: "2026年10月", startDate: "2026-10-01", endDate: "2026-10-01" });
    expect(p.collection.actualAmount).toBe(p.kpis.periodContractAmount);
    expect(p.collection.targetConfigured).toBe(true);
    expect(p.kpis.periodPaidAmount).toBe("450000.00");
    expect(p.kpis.periodUnpaidAmount).toBe("240000.00");
    expect(p.collection.totalUnpaidAmount).toBe("-300.00");
    expect(p.delivery.reminders.overdueTotal).toBe(60);
  });
  it("分批发货不按合同去重，未知地区保留，倍率只应用一次", async () => {
    const p = await getPublicSalesScreenPayload(id);
    expect(p.delivery.summary).toMatchObject({ shipmentCount: 6, unitCount: 18, regionCount: 1 });
    expect(p.delivery.regionUnits).toEqual([{ province: "山东省", shipmentCount: 4, unitCount: 10 }]);
    expect(p.delivery.unresolvedRegionTotals).toEqual({ shipmentCount: 2, unitCount: 8 });
    expect(p.delivery.routes).toHaveLength(2);
    expect(p.delivery.milestones).toHaveLength(2); // 未知地区的整单发货仍属于里程碑
    expect(p.delivery.milestonesTotal).toBe(4);
    expect(p.delivery.routesTotal).toBe(6);
    const json = JSON.stringify(p);
    for (const text of ["secret customer", "bad province", "PRIVATE-123456", "companyName", "multipliers"]) expect(json).not.toContain(text);
  });
  it("超过 80 条时汇总不截断，地区计数守恒", async () => {
    vi.mocked(prisma.shipment.findMany).mockResolvedValue([...Array.from({ length: 85 }, () => row("山东省")), row("bad province", 2)] as never);
    const p = await getPublicSalesScreenPayload(id);
    expect(p.delivery.routes).toHaveLength(80);
    expect(p.delivery.summary.unitCount).toBe(174);
    expect(p.delivery.regionUnits!.reduce((sum, r) => sum + r.unitCount, 0) + p.delivery.unresolvedRegionTotals!.unitCount).toBe(p.delivery.summary.unitCount);
    expect(p.delivery.regionUnits!.reduce((sum, r) => sum + r.shipmentCount, 0) + p.delivery.unresolvedRegionTotals!.shipmentCount).toBe(p.delivery.summary.shipmentCount);
    expect(p.delivery.regionUnits!.length).toBe(p.delivery.summary.regionCount);
    expect(vi.mocked(prisma.shipment.findMany).mock.calls[0][0]).not.toHaveProperty("take");
  });
  it("未设置目标不抹掉实际完成；历史零目标仍能区别", async () => {
    vi.mocked(prisma.salesTarget.findFirst).mockResolvedValue(null);
    const missing = await getPublicSalesScreenPayload(id);
    expect(missing.collection.targetConfigured).toBe(false);
    expect(missing.collection.actualAmount).toBe("300000.00");
    vi.mocked(prisma.salesTarget.findFirst).mockResolvedValue({ amount: "0" } as never);
    const zero = await getPublicSalesScreenPayload(id);
    expect(zero.collection.targetConfigured).toBe(true);
    expect(zero.collection.targetRate).toBe(0);
  });
  it("负计数保留并记录不含身份的异常日志", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(readScreenMetrics).mockResolvedValue({ range: {}, stats: { ...stats, totalCustomers: -1 }, shipmentReminders: { today: [], sevenDays: [], overdue: [] } } as never);
    const p = await getPublicSalesScreenPayload(id);
    expect(p.kpis.totalCustomers).toBe(-3);
    expect(warn).toHaveBeenCalledWith("[screen] negative count", { field: "totalCustomers", value: -1 });
    warn.mockRestore();
  });
});
