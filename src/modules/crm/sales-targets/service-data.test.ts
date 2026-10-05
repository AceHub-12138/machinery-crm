import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/lib/permissions";

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  findMany: vi.fn(),
  findFirstUser: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
  transaction: vi.fn(),
  writeOperationLog: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { aggregate: mocks.aggregate },
    salesTarget: { findMany: mocks.findMany },
    user: { findFirst: mocks.findFirstUser },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/sales-items", () => ({ writeOperationLog: mocks.writeOperationLog }));
vi.mock("@/lib/permissions", () => ({
  canSeeAllData: (user: { role: string }) => user.role === "SUPER_ADMIN",
  customerIsolationWhere: (user: SessionUser) => ({
    businessLine: user.role === "FOREIGN_TRADE" ? "外贸" : "国内销售",
    ...(user.territories.length
      ? {
          OR: user.territories.map((territory) => ({
            province: territory.province,
            ...(territory.cities.length ? { city: { in: territory.cities } } : {}),
          })),
        }
      : { id: "__NO_ACCESS__" }),
  }),
  matchesTerritory: () => false,
}));

import { getActualAmount, listSalesTargets, saveSalesTarget } from "./service";

const salesUser: SessionUser = {
  id: "sales-1",
  role: "SALES",
  region: "山东",
  territories: [{ province: "山东省", cities: ["济南市"] }],
  viewScope: "TERRITORY",
  name: "销售甲",
};

const admin: SessionUser = {
  id: "admin-1",
  role: "SUPER_ADMIN",
  region: "",
  territories: [],
  viewScope: "ALL",
  name: "管理员",
};

const period = {
  periodType: "MONTH",
  periodYear: 2026,
  periodIndex: 8,
  start: new Date(2026, 7, 1),
  end: new Date(2026, 8, 1),
  label: "2026年8月",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sales target actual amount", () => {
  it("uses crmDashboardScope, dashboard createdAt range, and the selected KPI sum", async () => {
    mocks.aggregate.mockResolvedValue({
      _sum: { amount: new Prisma.Decimal("120.00"), paidAmount: new Prisma.Decimal("45.00") },
    });

    await expect(
      getActualAmount(salesUser, period, "PAID_AMOUNT", salesUser.id),
    ).resolves.toEqual(new Prisma.Decimal("45.00"));
    expect(mocks.aggregate).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        customer: {
          deletedAt: null,
          businessLine: "国内销售",
          OR: [{ province: "山东省", city: { in: ["济南市"] } }],
          assignedUserId: salesUser.id,
        },
        salesUserId: salesUser.id,
        createdAt: { gte: period.start, lt: period.end },
      },
      _sum: { amount: true, paidAmount: true },
    });
  });

  it("rejects company-wide actuals for a non-admin caller", async () => {
    await expect(
      getActualAmount(salesUser, period, "CONTRACT_AMOUNT", null),
    ).rejects.toMatchObject({ status: 403, message: "无权限读取全公司目标" });
    expect(mocks.aggregate).not.toHaveBeenCalled();
  });

  it("returns only the personal target for non-admin", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "personal", amount: new Prisma.Decimal("100"), salesUserId: salesUser.id, updatedAt: new Date("2026-08-10T00:00:00Z"), metric: "CONTRACT_AMOUNT" },
      { id: "global", amount: new Prisma.Decimal("500"), salesUserId: null, updatedAt: new Date("2026-08-09T00:00:00Z"), metric: "CONTRACT_AMOUNT" },
    ]);
    mocks.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal("126.50"), paidAmount: new Prisma.Decimal("0") } });

    const result = await listSalesTargets(salesUser, period, "CONTRACT_AMOUNT");

    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]).toMatchObject({ id: "personal", completionRate: 126.5, visualRate: 100 });
    expect(mocks.aggregate).toHaveBeenCalledTimes(1);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ salesUserId: salesUser.id }),
    }));
  });

  it("returns personal and global targets for admin", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "personal", amount: new Prisma.Decimal("100"), salesUserId: salesUser.id, updatedAt: new Date("2026-08-10T00:00:00Z"), metric: "CONTRACT_AMOUNT" },
      { id: "global", amount: new Prisma.Decimal("500"), salesUserId: null, updatedAt: new Date("2026-08-09T00:00:00Z"), metric: "CONTRACT_AMOUNT" },
    ]);
    mocks.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal("126.50"), paidAmount: new Prisma.Decimal("0") } });

    const result = await listSalesTargets(admin, period, "CONTRACT_AMOUNT");

    expect(result.targets).toHaveLength(2);
    expect(result.targets[0]).toMatchObject({ id: "personal", actualAmount: "126.50" });
    expect(result.targets[1]).toMatchObject({ id: "global", actualAmount: "126.50", completionRate: 25.3 });
    expect(mocks.aggregate).toHaveBeenCalledTimes(2);
    expect(mocks.aggregate.mock.calls[1][0].where).toEqual({
      deletedAt: null,
      customer: { deletedAt: null },
      createdAt: { gte: period.start, lt: period.end },
    });
  });
});

describe("sales target upsert", () => {
  it("updates one global row and removes nullable-unique duplicates in the same transaction", async () => {
    const first = { id: "target-1", amount: new Prisma.Decimal("80"), updatedAt: new Date("2026-08-10T00:00:00Z") };
    const duplicate = { id: "target-2", amount: new Prisma.Decimal("70"), updatedAt: new Date("2026-08-09T00:00:00Z") };
    const saved = { ...first, amount: new Prisma.Decimal("100"), salesUserId: null, metric: "CONTRACT_AMOUNT", periodType: "MONTH", periodYear: 2026, periodIndex: 8 };
    const tx = {
      salesTarget: {
        findMany: vi.fn().mockResolvedValue([first, duplicate]),
        create: mocks.create,
        update: mocks.update.mockResolvedValue(saved),
        deleteMany: mocks.deleteMany.mockResolvedValue({ count: 1 }),
      },
    };
    mocks.transaction.mockImplementation(async (run) => run(tx));

    await expect(
      saveSalesTarget(admin, {
        periodType: "MONTH",
        periodYear: 2026,
        periodIndex: 8,
        metric: "CONTRACT_AMOUNT",
        amount: "100.00",
        salesUserId: null,
        note: "八月目标",
      }),
    ).resolves.toMatchObject({ id: "target-1", amount: new Prisma.Decimal("100") });

    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["target-2"] } } });
    expect(mocks.writeOperationLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "UPDATE_SALES_TARGET", entityId: "target-1" }),
    );
  });
});
