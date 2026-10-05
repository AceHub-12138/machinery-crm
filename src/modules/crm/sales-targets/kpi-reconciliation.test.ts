import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/lib/permissions";

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  count: vi.fn().mockResolvedValue(0),
  findMany: vi.fn().mockResolvedValue([]),
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
vi.mock("@/lib/sales-items", () => ({ writeOperationLog: vi.fn() }));
vi.mock("@/lib/permissions", () => ({
  canSeeAllData: (user: SessionUser) => user.role === "SUPER_ADMIN",
  customerIsolationWhere: (user: SessionUser) => ({
    businessLine: user.role === "FOREIGN_TRADE" ? "外贸" : "国内销售",
    OR: user.territories.map((territory) => ({ province: territory.province })),
  }),
  matchesTerritory: () => false,
}));

import { getCrmDashboard } from "@/modules/crm/dashboard/service";
import { getActualAmount } from "./service";

describe("sales target KPI reconciliation", () => {
  it("uses the exact dashboard period where and returns the same contract amount", async () => {
    const user: SessionUser = {
      id: "sales-1",
      role: "SALES",
      region: "山东",
      territories: [{ province: "山东省", cities: [] }],
      viewScope: "TERRITORY",
    };
    const total = new Prisma.Decimal("765432.10");
    mocks.aggregate.mockResolvedValue({ _sum: { amount: total, paidAmount: new Prisma.Decimal("100"), unpaidAmount: new Prisma.Decimal("0") } });
    const query = new URLSearchParams({
      preset: "custom",
      start: "2026-08-01",
      end: "2026-08-31",
      salesUserId: user.id,
    });

    const dashboard = await getCrmDashboard(user, query);
    const actual = await getActualAmount(user, {
      periodType: "MONTH",
      periodYear: 2026,
      periodIndex: 8,
      start: new Date(2026, 7, 1),
      end: new Date(2026, 8, 1),
      label: "2026年8月",
    }, "CONTRACT_AMOUNT", user.id);

    expect(new Prisma.Decimal(String(dashboard.stats.periodContractAmount)).toFixed(2)).toBe(actual.toFixed(2));
    expect(mocks.aggregate.mock.calls[0][0].where).toEqual(mocks.aggregate.mock.calls[2][0].where);
  });
});
