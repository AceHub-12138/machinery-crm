import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/lib/permissions";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    customer: {
      count: mocks.count,
      findMany: mocks.findMany,
    },
  },
}));
vi.mock("@/lib/permissions", () => ({
  buildCustomerWhereClause: (user: { role: string; territories: Array<{ province: string }> }) => ({
    deletedAt: null,
    businessLine: user.role === "FOREIGN_TRADE" ? "外贸" : "国内销售",
    OR: user.territories.map((territory) => ({ province: territory.province })),
  }),
  canSeeAllData: () => false,
  isSuperAdmin: () => false,
  matchesTerritory: () => true,
}));
vi.mock("@/lib/sales-items", () => ({ writeOperationLog: vi.fn() }));
vi.mock("@/modules/crm/permissions", () => ({ canAccessCrmData: () => true }));

import { listCustomers } from "./service";

const salesUser: SessionUser = {
  id: "sales-1",
  role: "SALES",
  region: "山东",
  territories: [{ province: "山东省", cities: [] }],
  viewScope: "TERRITORY",
};
const foreignTradeUser: SessionUser = {
  ...salesUser,
  id: "foreign-1",
  role: "FOREIGN_TRADE",
};

describe("customer list KPI date filters", () => {
  beforeEach(() => {
    mocks.count.mockReset().mockResolvedValue(0);
    mocks.findMany.mockReset().mockResolvedValue([]);
  });

  it("adds createdStart to the existing permission where", async () => {
    await listCustomers(salesUser, new URLSearchParams({ createdStart: "2026-08-01" }));

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        deletedAt: null,
        businessLine: "国内销售",
        OR: [{ province: "山东省" }],
        createdAt: { gte: new Date(2026, 7, 1) },
      },
    }));
  });

  it("uses the next local midnight as the exclusive createdEnd boundary", async () => {
    await listCustomers(salesUser, new URLSearchParams({ createdEnd: "2026-08-20" }));

    expect(mocks.findMany.mock.calls[0][0].where.createdAt).toEqual({
      lt: new Date(2026, 7, 21),
    });
  });

  it("combines createdStart and createdEnd into one inclusive-exclusive range", async () => {
    await listCustomers(salesUser, new URLSearchParams({
      createdStart: "2026-08-01",
      createdEnd: "2026-08-20",
    }));

    expect(mocks.findMany.mock.calls[0][0].where.createdAt).toEqual({
      gte: new Date(2026, 7, 1),
      lt: new Date(2026, 7, 21),
    });
  });

  it("matches the Dashboard customer KPI where for province, owner, status, and period", async () => {
    await listCustomers(salesUser, new URLSearchParams({
      province: "山东省",
      assignedUserId: "sales-1",
      status: "NEW_LEAD",
      createdStart: "2026-08-01",
      createdEnd: "2026-08-20",
    }));

    expect(mocks.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      businessLine: "国内销售",
      OR: [{ province: "山东省" }],
      province: "山东省",
      assignedUserId: "sales-1",
      status: "NEW_LEAD",
      createdAt: {
        gte: new Date(2026, 7, 1),
        lt: new Date(2026, 7, 21),
      },
    });
  });

  it.each([
    ["province and customer status", { province: "山东省", status: "NEW_LEAD" }, {
      province: "山东省",
      status: "NEW_LEAD",
    }],
    ["province and sales owner", { province: "山东省", assignedUserId: "sales-1" }, {
      province: "山东省",
      assignedUserId: "sales-1",
    }],
  ])("matches the Dashboard customer KPI where with %s", async (_label, filters, expected) => {
    await listCustomers(salesUser, new URLSearchParams({
      createdStart: "2026-08-01",
      ...filters,
    }));

    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject(expected);
  });

  it("keeps FOREIGN_TRADE KPI filters inside the foreign business line", async () => {
    await listCustomers(foreignTradeUser, new URLSearchParams({
      province: "山东省",
      assignedUserId: "foreign-1",
      status: "NEW_LEAD",
      createdStart: "2026-08-01",
    }));

    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({
      deletedAt: null,
      businessLine: "外贸",
      province: "山东省",
      assignedUserId: "foreign-1",
      status: "NEW_LEAD",
    });
  });

  it("keeps the base SALES permission where when URL filters target another owner", async () => {
    await listCustomers(salesUser, new URLSearchParams({
      assignedUserId: "sales-2",
      createdStart: "2026-08-01",
    }));

    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({
      deletedAt: null,
      businessLine: "国内销售",
      assignedUserId: "sales-2",
    });
  });

  it.each([
    [salesUser, "国内销售"],
    [foreignTradeUser, "外贸"],
  ])("applies KPI sales scope to the visible customer owner inside existing permissions", async (user, businessLine) => {
    await listCustomers(user, new URLSearchParams({
      kpiSalesUserId: user.id,
      createdStart: "2026-08-01",
    }));

    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({
      deletedAt: null,
      businessLine,
      assignedUserId: user.id,
    });
  });

  it("returns no rows when SALES tampers with another user's customer KPI scope", async () => {
    await listCustomers(salesUser, new URLSearchParams({
      kpiSalesUserId: "sales-2",
      createdStart: "2026-08-01",
    }));

    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({
      deletedAt: null,
      businessLine: "国内销售",
      id: "__NO_ACCESS__",
    });
    expect(mocks.findMany.mock.calls[0][0].where.assignedUserId).toBeUndefined();
  });

  it("keeps territory isolation when SALES tampers with an out-of-area customer province", async () => {
    await listCustomers(salesUser, new URLSearchParams({
      province: "河北省",
      createdStart: "2026-08-01",
    }));

    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({
      deletedAt: null,
      businessLine: "国内销售",
      OR: [{ province: "山东省" }],
      province: "河北省",
    });
  });

  it.each(["2026/08/01", "2026-02-30"])("rejects invalid created dates before Prisma: %s", async (value) => {
    await expect(listCustomers(salesUser, new URLSearchParams({ createdStart: value }))).rejects.toMatchObject({
      message: "创建日期筛选格式错误",
      status: 400,
    });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("keeps the original where unchanged when no KPI date is provided", async () => {
    await listCustomers(salesUser, new URLSearchParams());

    expect(mocks.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      businessLine: "国内销售",
      OR: [{ province: "山东省" }],
    });
  });
});
