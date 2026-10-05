import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/modules/shared/domain-error";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listSalesTargets: vi.fn(),
  parseSalesTargetMetric: vi.fn((value) => value || "CONTRACT_AMOUNT"),
  parseSalesTargetPeriod: vi.fn(() => ({
    periodType: "MONTH",
    periodYear: 2026,
    periodIndex: 8,
    start: new Date(2026, 7, 1),
    end: new Date(2026, 8, 1),
    label: "2026年8月",
  })),
  saveSalesTarget: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("./service", () => ({
  listSalesTargets: mocks.listSalesTargets,
  parseSalesTargetMetric: mocks.parseSalesTargetMetric,
  parseSalesTargetPeriod: mocks.parseSalesTargetPeriod,
  saveSalesTarget: mocks.saveSalesTarget,
}));

import { GET, POST } from "@/app/api/crm/sales-targets/route";

const admin = { id: "admin", role: "SUPER_ADMIN", region: "", territories: [], viewScope: "ALL" } as const;
const sales = { id: "sales", role: "SALES", region: "山东", territories: [], viewScope: "TERRITORY" } as const;

beforeEach(() => vi.clearAllMocks());

describe("sales targets route", () => {
  it("returns 401 for unauthenticated reads and writes", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await GET(new NextRequest("http://localhost/api/crm/sales-targets"))).status).toBe(401);
    expect((await POST(new NextRequest("http://localhost/api/crm/sales-targets", { method: "POST", body: "{}" }))).status).toBe(401);
  });

  it("returns the service 403 when a sales user attempts to write", async () => {
    mocks.getSessionUser.mockResolvedValue(sales);
    mocks.saveSalesTarget.mockRejectedValue(new DomainError("无权限设置销售目标", 403));
    const response = await POST(new NextRequest("http://localhost/api/crm/sales-targets", { method: "POST", body: "{}" }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "无权限设置销售目标" });
  });

  it("returns a SUPER_ADMIN upsert and a scoped target list", async () => {
    mocks.getSessionUser.mockResolvedValue(admin);
    mocks.saveSalesTarget.mockResolvedValue({ id: "target-1" });
    mocks.listSalesTargets.mockResolvedValue({ period: { label: "2026年8月" }, targets: [] });

    const saved = await POST(new NextRequest("http://localhost/api/crm/sales-targets", {
      method: "POST",
      body: JSON.stringify({ periodType: "MONTH", periodYear: 2026, periodIndex: 8, metric: "CONTRACT_AMOUNT", amount: "100" }),
    }));
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toEqual({ id: "target-1" });

    const listed = await GET(new NextRequest("http://localhost/api/crm/sales-targets?periodType=MONTH&year=2026&month=8"));
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toEqual({ period: { label: "2026年8月" }, targets: [] });
  });

  it("maps validation failures to 400 and unexpected data errors to 500", async () => {
    mocks.getSessionUser.mockResolvedValue(admin);
    mocks.saveSalesTarget.mockRejectedValueOnce(new DomainError("目标金额必须大于 0", 400));
    const invalid = await POST(new NextRequest("http://localhost/api/crm/sales-targets", { method: "POST", body: "{}" }));
    expect(invalid.status).toBe(400);

    mocks.listSalesTargets.mockRejectedValueOnce(new Error("database unavailable"));
    const failed = await GET(new NextRequest("http://localhost/api/crm/sales-targets"));
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toEqual({ error: "销售目标加载失败" });
  });
});
