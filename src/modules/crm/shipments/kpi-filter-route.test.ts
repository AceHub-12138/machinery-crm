import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    shipment: { findMany: mocks.findMany },
  },
}));
vi.mock("@/lib/permissions", () => ({
  getSessionUser: mocks.getSessionUser,
  isSuperAdmin: () => true,
  canSeeAllData: (user: { role: string }) => user.role === "SUPER_ADMIN",
  customerIsolationWhere: (user: { role: string; territories: Array<{ province: string }> }) => ({
    businessLine: user.role === "FOREIGN_TRADE" ? "外贸" : "国内销售",
    OR: user.territories.map((territory) => ({ province: territory.province })),
  }),
  canAccessCustomer: () => true,
}));
vi.mock("@/lib/sales-items", () => ({ writeOperationLog: vi.fn() }));

import { GET } from "@/app/api/shipments/route";

describe("Shipments KPI date filters", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 20, 14, 30));
    mocks.findMany.mockReset().mockResolvedValue([]);
    mocks.getSessionUser.mockReset().mockResolvedValue({
      id: "admin-1",
      role: "SUPER_ADMIN",
      region: "",
      territories: [],
      viewScope: "ALL",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("matches the Dashboard active-customer and date boundaries", async () => {
    const response = await GET(new NextRequest("http://localhost/api/shipments?dateStart=2026-08-01&dateEnd=2026-08-20"));

    expect(response.status).toBe(200);
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({
      contract: {
        deletedAt: null,
        customer: { deletedAt: null },
      },
      shipmentDate: {
        gte: new Date(2026, 7, 1),
        lt: new Date(2026, 7, 21),
      },
    });
  });

  it.each([
    ["province", "province=山东省", {
      contract: { customer: { AND: [{ province: "山东省" }], deletedAt: null } },
    }],
    ["dual sales scope", "kpiSalesUserId=sales-1", {
      contract: {
        customer: { AND: [{ assignedUserId: "sales-1" }], deletedAt: null },
        salesUserId: "sales-1",
      },
    }],
    ["shipment status", "status=SHIPPED", { shipmentStatus: "SHIPPED" }],
    ["contract status", "contractStatus=SHIPPED", {
      contract: {
        shipments: { some: { shipmentStatus: { in: ["PARTIAL_SHIPPED", "SHIPPED"] } } },
      },
    }],
  ])("matches the Dashboard period shipment where with %s", async (_label, query, expected) => {
    await GET(new NextRequest(`http://localhost/api/shipments?dateStart=2026-08-01&${query}`));

    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject(expected);
  });

  it("matches the Dashboard shipment where for all participating filters", async () => {
    await GET(new NextRequest(
      "http://localhost/api/shipments?dateStart=2026-08-01&dateEnd=2026-08-20&province=山东省&kpiSalesUserId=sales-1&contractStatus=PRODUCTION&status=SHIPPED",
    ));

    expect(mocks.findMany.mock.calls[0][0].where).toEqual({
      contract: {
        deletedAt: null,
        customer: {
          AND: [
            { province: "山东省" },
            { assignedUserId: "sales-1" },
          ],
          deletedAt: null,
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
      shipmentDate: {
        gte: new Date(2026, 7, 1),
        lt: new Date(2026, 7, 21),
      },
    });
  });

  it("matches the Dashboard OVERDUE shipment status that replaces the period range", async () => {
    await GET(new NextRequest(
      "http://localhost/api/shipments?province=山东省&kpiSalesUserId=sales-1&contractStatus=SIGNED&status=OVERDUE",
    ));

    expect(mocks.findMany.mock.calls[0][0].where).toEqual({
      contract: {
        deletedAt: null,
        customer: {
          AND: [
            { province: "山东省" },
            { assignedUserId: "sales-1" },
          ],
          deletedAt: null,
        },
        salesUserId: "sales-1",
        contractStatus: "SIGNED",
      },
      shipmentDate: { lt: new Date(2026, 7, 20) },
      shipmentStatus: { not: "SHIPPED" },
    });
  });

  it("keeps the existing no-parameter query unchanged", async () => {
    await GET(new NextRequest("http://localhost/api/shipments"));

    expect(mocks.findMany.mock.calls[0][0].where).toEqual({
      contract: { deletedAt: null },
    });
  });

  it("adds the KPI date condition without replacing sales isolation", async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: "sales-1",
      role: "SALES",
      region: "山东",
      territories: [{ province: "山东省", cities: [] }],
      viewScope: "TERRITORY",
    });

    await GET(new NextRequest("http://localhost/api/shipments?dateStart=2026-08-01"));

    expect(mocks.findMany.mock.calls[0][0].where.contract.customer).toEqual({
      AND: [{
        businessLine: "国内销售",
        OR: [{ province: "山东省" }],
      }],
      deletedAt: null,
    });
  });

  it.each([
    ["SALES", "国内销售"],
    ["FOREIGN_TRADE", "外贸"],
  ])("keeps %s shipment KPI scope inside its business line", async (role, businessLine) => {
    mocks.getSessionUser.mockResolvedValue({
      id: "sales-1",
      role,
      region: "山东",
      territories: [{ province: "山东省", cities: [] }],
      viewScope: "TERRITORY",
    });

    await GET(new NextRequest(
      "http://localhost/api/shipments?dateStart=2026-08-01&kpiSalesUserId=sales-1",
    ));

    expect(mocks.findMany.mock.calls[0][0].where.contract).toMatchObject({
      customer: {
        AND: [
          {
            businessLine,
            OR: [{ province: "山东省" }],
          },
          { assignedUserId: "sales-1" },
        ],
        deletedAt: null,
      },
      salesUserId: "sales-1",
    });
  });

  it("returns no rows when SALES tampers with another user's shipment KPI scope", async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: "sales-1",
      role: "SALES",
      region: "山东",
      territories: [{ province: "山东省", cities: [] }],
      viewScope: "TERRITORY",
    });

    await GET(new NextRequest(
      "http://localhost/api/shipments?dateStart=2026-08-01&kpiSalesUserId=sales-2",
    ));

    expect(mocks.findMany.mock.calls[0][0].where.contract.customer).toMatchObject({
      AND: [
        {
          businessLine: "国内销售",
          OR: [{ province: "山东省" }],
        },
        { id: "__NO_ACCESS__" },
      ],
      deletedAt: null,
    });
    expect(mocks.findMany.mock.calls[0][0].where.contract.salesUserId).toBeUndefined();
  });

  it("keeps territory isolation when SALES tampers with an out-of-area shipment province", async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: "sales-1",
      role: "SALES",
      region: "山东",
      territories: [{ province: "山东省", cities: [] }],
      viewScope: "TERRITORY",
    });

    await GET(new NextRequest(
      "http://localhost/api/shipments?dateStart=2026-08-01&province=河北省",
    ));

    expect(mocks.findMany.mock.calls[0][0].where.contract.customer).toEqual({
      AND: [
        {
          businessLine: "国内销售",
          OR: [{ province: "山东省" }],
        },
        { province: "河北省" },
      ],
      deletedAt: null,
    });
  });
});
