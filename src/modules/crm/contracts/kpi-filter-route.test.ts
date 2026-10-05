import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findMany: mocks.findMany },
  },
}));
vi.mock("@/lib/permissions", () => ({
  getSessionUser: mocks.getSessionUser,
  isSuperAdmin: () => true,
  canAccessCustomer: () => true,
  canSeeAllData: (user: { role: string }) => user.role === "SUPER_ADMIN",
  customerIsolationWhere: (user: { role: string; territories: Array<{ province: string }> }) => ({
    businessLine: user.role === "FOREIGN_TRADE" ? "外贸" : "国内销售",
    OR: user.territories.map((territory) => ({ province: territory.province })),
  }),
}));
vi.mock("@/lib/sales-items", () => ({
  buildItemsFromInputs: vi.fn(),
  sumItems: vi.fn(),
  writeOperationLog: vi.fn(),
}));

import { GET } from "@/app/api/contracts/route";

describe("Contracts KPI filters", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 20, 14, 30));
    mocks.findMany.mockReset().mockResolvedValue([]);
    mocks.getSessionUser.mockReset().mockResolvedValue({
      id: "admin-1",
      role: "SUPER_ADMIN",
      region: null,
      territories: [],
      viewScope: "ALL",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies the Dashboard overdue shipment condition at local midnight", async () => {
    const response = await GET(new NextRequest("http://localhost/api/contracts?overdueShipment=1"));

    expect(response.status).toBe(200);
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      customer: { deletedAt: null },
      estimatedShipmentDate: { not: null, lt: new Date(2026, 7, 20) },
      shipments: { none: { shipmentStatus: "SHIPPED" } },
    });
  });

  it("matches the Dashboard overdue where for province, dual sales scope, and contract status", async () => {
    await GET(new NextRequest(
      "http://localhost/api/contracts?overdueShipment=1&province=山东省&kpiSalesUserId=sales-1&contractStatus=PRODUCTION",
    ));

    expect(mocks.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      customer: {
        province: "山东省",
        assignedUserId: "sales-1",
        deletedAt: null,
      },
      salesUserId: "sales-1",
      contractStatus: "SIGNED",
      estimatedShipmentDate: { not: null, lt: new Date(2026, 7, 20) },
      shipments: { none: { shipmentStatus: "SHIPPED" } },
    });
  });

  it.each([
    ["province", "province=山东省", { customer: { province: "山东省", deletedAt: null } }],
    ["dual sales scope", "kpiSalesUserId=sales-1", {
      customer: { assignedUserId: "sales-1", deletedAt: null },
      salesUserId: "sales-1",
    }],
    ["contract status", "contractStatus=DRAFT", { contractStatus: "DRAFT" }],
  ])("matches the Dashboard overdue where with %s", async (_label, query, expected) => {
    await GET(new NextRequest(`http://localhost/api/contracts?overdueShipment=1&${query}`));

    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({
      ...expected,
      estimatedShipmentDate: { not: null, lt: new Date(2026, 7, 20) },
      shipments: { none: { shipmentStatus: "SHIPPED" } },
    });
  });

  it("keeps the existing no-parameter query unchanged", async () => {
    const response = await GET(new NextRequest("http://localhost/api/contracts"));

    expect(response.status).toBe(200);
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
  });

  it("matches the Dashboard period contract customer and date boundaries", async () => {
    await GET(new NextRequest("http://localhost/api/contracts?createdStart=2026-08-01&createdEnd=2026-08-20"));

    expect(mocks.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      customer: { deletedAt: null },
      createdAt: {
        gte: new Date(2026, 7, 1),
        lt: new Date(2026, 7, 21),
      },
    });
  });

  it.each([
    ["province", "province=山东省", { customer: { province: "山东省", deletedAt: null } }],
    ["dual sales scope", "kpiSalesUserId=sales-1", {
      customer: { assignedUserId: "sales-1", deletedAt: null },
      salesUserId: "sales-1",
    }],
    ["contract status", "contractStatus=SHIPPED", {
      customer: { deletedAt: null },
      shipments: { some: { shipmentStatus: { in: ["PARTIAL_SHIPPED", "SHIPPED"] } } },
    }],
  ])("matches the Dashboard period contract where with %s", async (_label, query, expected) => {
    await GET(new NextRequest(`http://localhost/api/contracts?createdStart=2026-08-01&${query}`));

    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject(expected);
  });

  it("matches the Dashboard period contract where for province, dual sales scope, status, and period", async () => {
    await GET(new NextRequest(
      "http://localhost/api/contracts?createdStart=2026-08-01&createdEnd=2026-08-20&province=山东省&kpiSalesUserId=sales-1&contractStatus=PRODUCTION",
    ));

    expect(mocks.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      customer: {
        province: "山东省",
        assignedUserId: "sales-1",
        deletedAt: null,
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
  });

  it("adds overdue conditions without replacing the sales isolation where", async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: "sales-1",
      role: "SALES",
      region: "山东",
      territories: [{ province: "山东省", cities: [] }],
      viewScope: "TERRITORY",
    });

    await GET(new NextRequest("http://localhost/api/contracts?overdueShipment=1"));

    expect(mocks.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      customer: {
        businessLine: "国内销售",
        OR: [{ province: "山东省" }],
        deletedAt: null,
      },
      estimatedShipmentDate: { not: null, lt: new Date(2026, 7, 20) },
      shipments: { none: { shipmentStatus: "SHIPPED" } },
    });
  });

  it.each([
    ["SALES", "国内销售"],
    ["FOREIGN_TRADE", "外贸"],
  ])("keeps %s KPI sales scope inside its business line", async (role, businessLine) => {
    mocks.getSessionUser.mockResolvedValue({
      id: "sales-1",
      role,
      region: "山东",
      territories: [{ province: "山东省", cities: [] }],
      viewScope: "TERRITORY",
    });

    await GET(new NextRequest(
      "http://localhost/api/contracts?createdStart=2026-08-01&kpiSalesUserId=sales-1",
    ));

    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({
      customer: {
        businessLine,
        assignedUserId: "sales-1",
        deletedAt: null,
      },
      salesUserId: "sales-1",
    });
  });

  it("returns no rows when SALES tampers with another user's KPI sales scope", async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: "sales-1",
      role: "SALES",
      region: "山东",
      territories: [{ province: "山东省", cities: [] }],
      viewScope: "TERRITORY",
    });

    await GET(new NextRequest(
      "http://localhost/api/contracts?createdStart=2026-08-01&kpiSalesUserId=sales-2",
    ));

    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({
      customer: {
        businessLine: "国内销售",
        id: "__NO_ACCESS__",
        deletedAt: null,
      },
    });
    expect(mocks.findMany.mock.calls[0][0].where.salesUserId).toBeUndefined();
  });

  it("keeps territory isolation when SALES tampers with an out-of-area province", async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: "sales-1",
      role: "SALES",
      region: "山东",
      territories: [{ province: "山东省", cities: [] }],
      viewScope: "TERRITORY",
    });

    await GET(new NextRequest(
      "http://localhost/api/contracts?createdStart=2026-08-01&province=河北省",
    ));

    expect(mocks.findMany.mock.calls[0][0].where.customer).toEqual({
      businessLine: "国内销售",
      OR: [{ province: "山东省" }],
      province: "河北省",
      deletedAt: null,
    });
  });
});
