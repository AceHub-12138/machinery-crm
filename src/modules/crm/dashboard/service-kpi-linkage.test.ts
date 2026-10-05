import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/lib/permissions";

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  count: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    customer: { count: mocks.count, findMany: mocks.findMany },
    contract: { count: mocks.count, aggregate: mocks.aggregate, findMany: mocks.findMany },
    shipment: { count: mocks.count, findMany: mocks.findMany },
    followRecord: { findMany: mocks.findMany },
    user: { findMany: mocks.findMany },
  },
}));
vi.mock("@/lib/permissions", () => ({
  canSeeAllData: (user: SessionUser) => user.role === "SUPER_ADMIN",
  customerIsolationWhere: () => ({}),
  matchesTerritory: () => false,
}));

import { getCrmDashboard } from "./service";
import { overdueShipmentWhere } from "./kpi-linkage";

const admin: SessionUser = {
  id: "admin-1",
  role: "SUPER_ADMIN",
  region: "",
  territories: [],
  viewScope: "ALL",
};
const sales: SessionUser = {
  id: "sales-1",
  role: "SALES",
  region: "山东",
  territories: [{ province: "山东省", cities: [] }],
  viewScope: "TERRITORY",
};

describe("Dashboard KPI linkage response", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 20, 12, 0));
    mocks.count.mockReset().mockResolvedValue(0);
    mocks.findMany.mockReset().mockResolvedValue([]);
    mocks.aggregate.mockReset().mockResolvedValue({
      _sum: { amount: null, paidAmount: null, unpaidAmount: null },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns inclusive YYYY-MM-DD values for the current Dashboard period", async () => {
    const result = await getCrmDashboard(admin, new URLSearchParams({ preset: "month" }));

    expect(result.range).toMatchObject({
      startDate: "2026-08-01",
      endDate: "2026-08-20",
    });
  });

  it("uses the injected clock for the period so a month-boundary request stays consistent", async () => {
    // 系统时钟已越过 10 月零点；注入 9 月末时钟时，统计周期必须仍是 9 月
    vi.setSystemTime(new Date(2026, 9, 1, 0, 30));

    const result = await getCrmDashboard(admin, new URLSearchParams(), new Date(2026, 8, 30, 23, 59, 0));

    expect(result.range).toMatchObject({
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
  });

  it("returns the province and business filters that actually shaped the KPI where", async () => {
    const result = await getCrmDashboard(admin, new URLSearchParams({
      preset: "month",
      province: "山东省",
      salesUserId: "sales-1",
      customerStatus: "NEW_LEAD",
      contractStatus: "SIGNED",
      shipmentStatus: "SHIPPED",
    }));

    expect(result.filters).toEqual({
      province: "山东省",
      region: "",
      salesUserId: "sales-1",
      customerStatus: "NEW_LEAD",
      contractStatus: "SIGNED",
      shipmentStatus: "SHIPPED",
    });
  });

  it("preserves denied province and sales filter values so KPI links remain an empty result", async () => {
    const result = await getCrmDashboard(sales, new URLSearchParams({
      preset: "month",
      province: "越权省份",
      salesUserId: "sales-2",
    }));

    expect(result.filters).toMatchObject({
      province: "越权省份",
      salesUserId: "sales-2",
    });
    expect(mocks.count.mock.calls.map(([input]) => input.where)).toContainEqual(expect.objectContaining({
      id: "__NO_ACCESS__",
    }));
  });

  it.each([
    ["today", {}, "2026-08-20", "2026-08-20"],
    ["yesterday", {}, "2026-08-19", "2026-08-19"],
    ["7d", {}, "2026-08-14", "2026-08-20"],
    ["lastMonth", {}, "2026-07-01", "2026-07-31"],
    ["quarter", {}, "2026-07-01", "2026-08-20"],
    ["year", {}, "2026-01-01", "2026-08-20"],
    ["custom", { start: "2026-08-05", end: "2026-08-07" }, "2026-08-05", "2026-08-07"],
  ])("returns the current %s range for KPI links", async (preset, custom, startDate, endDate) => {
    const result = await getCrmDashboard(admin, new URLSearchParams({ preset, ...custom }));

    expect(result.range).toMatchObject({ startDate, endDate });
  });

  it("uses the shared overdue condition for its KPI count", async () => {
    await getCrmDashboard(admin, new URLSearchParams({ preset: "month" }));

    expect(mocks.count.mock.calls.map(([input]) => input.where)).toContainEqual({
      deletedAt: null,
      customer: { deletedAt: null },
      ...overdueShipmentWhere(new Date(2026, 7, 20)),
    });
  });

  it("builds the four KPI Prisma where clauses from only their participating filters", async () => {
    await getCrmDashboard(admin, new URLSearchParams({
      preset: "custom",
      start: "2026-08-01",
      end: "2026-08-20",
      province: "山东省",
      salesUserId: "sales-1",
      customerStatus: "NEW_LEAD",
      contractStatus: "PRODUCTION",
      shipmentStatus: "SHIPPED",
    }));

    const whereCalls = mocks.count.mock.calls.map(([input]) => input.where);
    expect(whereCalls).toContainEqual({
      deletedAt: null,
      province: "山东省",
      assignedUserId: "sales-1",
      status: "NEW_LEAD",
      createdAt: {
        gte: new Date(2026, 7, 1),
        lt: new Date(2026, 7, 21),
      },
    });
    expect(mocks.aggregate.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      customer: {
        deletedAt: null,
        province: "山东省",
        assignedUserId: "sales-1",
      },
      salesUserId: "sales-1",
      contractStatus: "SIGNED",
      shipments: {
        none: {
          shipmentStatus: { in: ["PARTIAL_SHIPPED", "SHIPPED"] },
        },
      },
      createdAt: {
        gte: new Date(2026, 7, 1),
        lt: new Date(2026, 7, 21),
      },
    });
    expect(whereCalls).toContainEqual({
      shipmentDate: {
        gte: new Date(2026, 7, 1),
        lt: new Date(2026, 7, 21),
      },
      contract: {
        deletedAt: null,
        customer: {
          deletedAt: null,
          province: "山东省",
          assignedUserId: "sales-1",
        },
        salesUserId: "sales-1",
        contractStatus: "SIGNED",
        shipments: {
          none: {
            shipmentStatus: { in: ["PARTIAL_SHIPPED", "SHIPPED"] },
          },
        },
      },
      shipmentStatus: "SHIPPED",
    });
    expect(whereCalls).toContainEqual({
      deletedAt: null,
      customer: {
        deletedAt: null,
        province: "山东省",
        assignedUserId: "sales-1",
      },
      salesUserId: "sales-1",
      contractStatus: "SIGNED",
      ...overdueShipmentWhere(new Date(2026, 7, 20)),
    });
  });

  it("replaces the shipment period when the Dashboard shipment filter is OVERDUE", async () => {
    await getCrmDashboard(admin, new URLSearchParams({
      preset: "custom",
      start: "2026-08-01",
      end: "2026-08-20",
      shipmentStatus: "OVERDUE",
    }));

    expect(mocks.count.mock.calls.map(([input]) => input.where)).toContainEqual({
      shipmentDate: { lt: new Date(2026, 7, 20) },
      shipmentStatus: { not: "SHIPPED" },
      contract: {
        deletedAt: null,
        customer: { deletedAt: null },
      },
    });
  });
});
