import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/lib/permissions";

const mocks = vi.hoisted(() => ({
  customerFindMany: vi.fn(),
  contractFindMany: vi.fn(),
  productFindMany: vi.fn(),
  materialFindMany: vi.fn(),
  purchaseOrderFindMany: vi.fn(),
  productionOrderFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    customer: { findMany: mocks.customerFindMany },
    contract: { findMany: mocks.contractFindMany },
    product: { findMany: mocks.productFindMany },
    material: { findMany: mocks.materialFindMany },
    purchaseOrder: { findMany: mocks.purchaseOrderFindMany },
    productionOrder: { findMany: mocks.productionOrderFindMany },
  },
}));

vi.mock("@/lib/dashboard-access", () => ({
  canAccessCrmDashboard: (role: string) =>
    ["SUPER_ADMIN", "SALES", "FOREIGN_TRADE"].includes(role),
}));

vi.mock("@/lib/erp-roles", () => ({
  canViewERP: (role: string) =>
    ["SUPER_ADMIN", "PURCHASE", "WAREHOUSE"].includes(role),
}));

vi.mock("@/lib/permissions", () => ({
  buildCustomerWhereClause: (user: SessionUser) =>
    user.role === "SUPER_ADMIN"
      ? { deletedAt: null }
      : {
          deletedAt: null,
          businessLine: user.role === "FOREIGN_TRADE" ? "外贸" : "国内销售",
          OR: user.territories.map((territory) => ({
            province: territory.province,
            ...(territory.cities.length
              ? { city: { in: territory.cities } }
              : {}),
          })),
        },
  customerIsolationWhere: (user: SessionUser) =>
    user.role === "SUPER_ADMIN"
      ? {}
      : {
          businessLine: user.role === "FOREIGN_TRADE" ? "外贸" : "国内销售",
          OR: user.territories.map((territory) => ({
            province: territory.province,
            ...(territory.cities.length
              ? { city: { in: territory.cities } }
              : {}),
          })),
        },
  canSeeAllData: (user: SessionUser) => user.role === "SUPER_ADMIN",
}));

import { search } from "./service";
import { filterNavForRole, getAllNavItems } from "./nav-index";

const salesUser: SessionUser = {
  id: "sales-1",
  role: "SALES",
  region: "山东",
  territories: [{ province: "山东省", cities: ["济南市"] }],
  viewScope: "TERRITORY",
  name: "销售甲",
};

const purchaseUser: SessionUser = {
  id: "purchase-1",
  role: "PURCHASE",
  region: "",
  territories: [],
  viewScope: "TERRITORY",
  name: "采购甲",
};

const warehouseUser: SessionUser = {
  id: "warehouse-1",
  role: "WAREHOUSE",
  region: "",
  territories: [],
  viewScope: "TERRITORY",
  name: "仓管甲",
};

const adminUser: SessionUser = {
  id: "admin-1",
  role: "SUPER_ADMIN",
  region: "",
  territories: [],
  viewScope: "ALL",
  name: "管理员",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.customerFindMany.mockResolvedValue([]);
  mocks.contractFindMany.mockResolvedValue([]);
  mocks.productFindMany.mockResolvedValue([]);
  mocks.materialFindMany.mockResolvedValue([]);
  mocks.purchaseOrderFindMany.mockResolvedValue([]);
  mocks.productionOrderFindMany.mockResolvedValue([]);
});

describe("global search", () => {
  it("applies the sidebar's ERP-only navigation rule to purchase users", () => {
    const items = filterNavForRole(getAllNavItems(), "PURCHASE");

    expect(items.some((item) => item.href === "/dashboard/crm")).toBe(true);
    expect(items.some((item) => item.href === "/erp/purchase-orders")).toBe(true);
    expect(items.some((item) => item.href === "/customers")).toBe(false);
    expect(items.some((item) => item.href === "/contracts")).toBe(false);
    expect(items.some((item) => item.href === "/admin/cockpit")).toBe(false);
  });

  it("places role-filtered navigation results before database results", async () => {
    mocks.purchaseOrderFindMany.mockResolvedValue([
      {
        id: "purchase-order-1",
        orderNo: "采购-001",
        status: "DRAFT",
        supplierNameSnapshot: "供应商",
      },
    ]);

    const result = await search("采购", purchaseUser);

    expect(result.results[0]).toMatchObject({
      type: "nav",
      group: "导航",
    });
    expect(result.results.some((item) => item.type === "purchase-order")).toBe(true);
    expect(result.results.filter((item) => item.type === "nav")).toHaveLength(3);
  });

  it("keeps other entity results when one database query fails", async () => {
    mocks.customerFindMany.mockResolvedValue([
      {
        id: "customer-1",
        companyName: "大川客户",
        contactName: "张经理",
        phone: null,
        province: "山东省",
        city: "济南市",
      },
    ]);
    mocks.productFindMany.mockRejectedValue(new Error("product query failed"));

    const result = await search("大川", salesUser);

    expect(result.results.some((item) => item.type === "customer")).toBe(true);
    expect(result.results.some((item) => item.type === "product")).toBe(false);
  });

  it("caps merged results at forty in the documented group order", async () => {
    const ids = Array.from({ length: 8 }, (_, index) => String(index + 1));
    mocks.customerFindMany.mockResolvedValue(ids.map((id) => ({
      id: `customer-${id}`,
      companyName: `客户${id}`,
      contactName: "联系人",
      phone: null,
      province: null,
      city: null,
    })));
    mocks.contractFindMany.mockResolvedValue(ids.map((id) => ({
      id: `contract-${id}`,
      contractNo: `HT-${id}`,
      amount: "1.00",
      customer: { companyName: "客户" },
    })));
    mocks.productFindMany.mockResolvedValue(ids.map((id) => ({
      id: `product-${id}`,
      model: `MODEL-${id}`,
      category: "机床",
      productType: "MAIN",
    })));
    mocks.materialFindMany.mockResolvedValue(ids.map((id) => ({
      id: `material-${id}`,
      code: `M-${id}`,
      name: `物料${id}`,
      spec: null,
    })));
    mocks.purchaseOrderFindMany.mockResolvedValue(ids.map((id) => ({
      id: `purchase-${id}`,
      orderNo: `PO-${id}`,
      status: "DRAFT",
      supplierNameSnapshot: "供应商",
    })));
    mocks.productionOrderFindMany.mockResolvedValue(ids.map((id) => ({
      id: `production-${id}`,
      orderNo: `MO-${id}`,
      status: "DRAFT",
      productModelSnapshot: "MODEL",
      productNameSnapshot: "产品",
    })));

    const result = await search("zz", adminUser);

    expect(result.results).toHaveLength(40);
    expect(result.results.slice(0, 8).every((item) => item.type === "customer")).toBe(true);
    expect(result.results.slice(32, 40).every((item) => item.type === "purchase-order")).toBe(true);
    expect(result.results.some((item) => item.type === "production-order")).toBe(false);
  });

  it("queries only the requested entity type before applying the result cap", async () => {
    mocks.productionOrderFindMany.mockResolvedValue([
      {
        id: "production-order-1",
        orderNo: "MO-2026-001",
        status: "ISSUED",
        productModelSnapshot: "BK5050",
        productNameSnapshot: "插床",
      },
    ]);

    const result = await search("BK5050", adminUser, "production-order");

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      type: "production-order",
      id: "production-order-1",
    });
    expect(mocks.customerFindMany).not.toHaveBeenCalled();
    expect(mocks.contractFindMany).not.toHaveBeenCalled();
    expect(mocks.productFindMany).not.toHaveBeenCalled();
    expect(mocks.materialFindMany).not.toHaveBeenCalled();
    expect(mocks.purchaseOrderFindMany).not.toHaveBeenCalled();
    expect(mocks.productionOrderFindMany).toHaveBeenCalledTimes(1);
  });

  it("returns no results and does not query the database for fewer than two characters", async () => {
    await expect(search(" 机 ", salesUser)).resolves.toEqual({ results: [] });

    expect(mocks.customerFindMany).not.toHaveBeenCalled();
    expect(mocks.contractFindMany).not.toHaveBeenCalled();
    expect(mocks.productFindMany).not.toHaveBeenCalled();
    expect(mocks.materialFindMany).not.toHaveBeenCalled();
    expect(mocks.purchaseOrderFindMany).not.toHaveBeenCalled();
    expect(mocks.productionOrderFindMany).not.toHaveBeenCalled();
  });

  it("searches customers within the sales user's territory", async () => {
    mocks.customerFindMany.mockResolvedValue([
      {
        id: "customer-1",
        companyName: "济南大川客户",
        contactName: "张经理",
        phone: "13800000000",
        province: "山东省",
        city: "济南市",
      },
    ]);

    const result = await search("大川", salesUser);

    expect(mocks.customerFindMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        businessLine: "国内销售",
        OR: [{ province: "山东省", city: { in: ["济南市"] } }],
        AND: [{
          OR: [
            { companyName: { contains: "大川" } },
            { contactName: { contains: "大川" } },
            { phone: { contains: "大川" } },
            { province: { contains: "大川" } },
            { city: { contains: "大川" } },
          ],
        }],
      },
      select: {
        id: true,
        companyName: true,
        contactName: true,
        phone: true,
        province: true,
        city: true,
      },
      take: 8,
    });
    expect(result.results).toContainEqual({
      type: "customer",
      id: "customer-1",
      title: "济南大川客户",
      subtitle: "张经理 · 13800000000 · 山东省济南市",
      href: "/customers",
      group: "客户",
    });
  });

  it("does not query customers for a purchase user", async () => {
    const result = await search("客户", purchaseUser);

    expect(result.results.filter((item) => item.type === "customer")).toEqual([]);
    expect(mocks.customerFindMany).not.toHaveBeenCalled();
  });

  it("searches materials for a warehouse user", async () => {
    mocks.materialFindMany.mockResolvedValue([
      { id: "material-1", code: "M-001", name: "主轴", spec: "BK50" },
    ]);

    const result = await search("主轴", warehouseUser);

    expect(mocks.materialFindMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        OR: [
          { code: { contains: "主轴" } },
          { name: { contains: "主轴" } },
          { spec: { contains: "主轴" } },
        ],
      },
      select: { id: true, code: true, name: true, spec: true },
      take: 8,
    });
    expect(result.results).toContainEqual({
      type: "material",
      id: "material-1",
      title: "主轴",
      subtitle: "M-001 · BK50",
      href: "/erp/materials",
      group: "物料",
    });
  });

  it("does not query materials for a sales user", async () => {
    const result = await search("物料", salesUser);

    expect(result.results.filter((item) => item.type === "material")).toEqual([]);
    expect(mocks.materialFindMany).not.toHaveBeenCalled();
  });

  it("searches contracts by customer territory without adding salesUserId", async () => {
    mocks.contractFindMany.mockResolvedValue([
      {
        id: "contract-1",
        contractNo: "DC-2026-001",
        amount: "500000.00",
        customer: { companyName: "济南客户" },
      },
    ]);

    await search("DC-2026", salesUser);

    expect(mocks.contractFindMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        customer: {
          businessLine: "国内销售",
          OR: [{ province: "山东省", city: { in: ["济南市"] } }],
        },
        OR: [
          { contractNo: { contains: "DC-2026" } },
          { customer: { companyName: { contains: "DC-2026" } } },
        ],
      },
      select: {
        id: true,
        contractNo: true,
        amount: true,
        customer: { select: { companyName: true } },
      },
      take: 8,
    });
    expect(mocks.contractFindMany.mock.calls[0][0].where).not.toHaveProperty(
      "salesUserId",
    );
  });

  it("searches customers across all territories for a super admin", async () => {
    await search("客户", adminUser);

    const where = mocks.customerFindMany.mock.calls[0][0].where;
    expect(where).toEqual({
      deletedAt: null,
      AND: [{
        OR: [
          { companyName: { contains: "客户" } },
          { contactName: { contains: "客户" } },
          { phone: { contains: "客户" } },
          { province: { contains: "客户" } },
          { city: { contains: "客户" } },
        ],
      }],
    });
    expect(where).not.toHaveProperty("businessLine");
  });

  it("searches active products for a purchase user without the CRM gate", async () => {
    mocks.productFindMany.mockResolvedValue([
      { id: "product-1", model: "BK5050", category: "插床", productType: "MAIN" },
    ]);

    const result = await search("BK5050", purchaseUser);

    expect(mocks.productFindMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        OR: [
          { model: { contains: "BK5050" } },
          { category: { contains: "BK5050" } },
          { remark: { contains: "BK5050" } },
        ],
      },
      select: { id: true, model: true, category: true, productType: true },
      take: 8,
    });
    expect(result.results).toContainEqual({
      type: "product",
      id: "product-1",
      title: "BK5050",
      subtitle: "插床 · MAIN",
      href: "/products",
      group: "产品",
    });
  });

  it("searches purchase orders for an ERP user", async () => {
    mocks.purchaseOrderFindMany.mockResolvedValue([
      {
        id: "purchase-order-1",
        orderNo: "PO-2026-001",
        status: "ORDERED",
        supplierNameSnapshot: "山东供应商",
      },
    ]);

    const result = await search("PO-2026", purchaseUser);

    expect(mocks.purchaseOrderFindMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        OR: [
          { orderNo: { contains: "PO-2026" } },
          { supplierNameSnapshot: { contains: "PO-2026" } },
        ],
      },
      select: {
        id: true,
        orderNo: true,
        status: true,
        supplierNameSnapshot: true,
      },
      take: 8,
    });
    expect(result.results).toContainEqual({
      type: "purchase-order",
      id: "purchase-order-1",
      title: "PO-2026-001",
      subtitle: "山东供应商 · ORDERED",
      href: "/erp/purchase-orders",
      group: "采购订单",
    });
  });

  it("searches production orders for an ERP user", async () => {
    mocks.productionOrderFindMany.mockResolvedValue([
      {
        id: "production-order-1",
        orderNo: "MO-2026-001",
        status: "ISSUED",
        productModelSnapshot: "BK5050",
        productNameSnapshot: "插床",
      },
    ]);

    const result = await search("BK5050", warehouseUser);

    expect(mocks.productionOrderFindMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        OR: [
          { orderNo: { contains: "BK5050" } },
          { productModelSnapshot: { contains: "BK5050" } },
          { productNameSnapshot: { contains: "BK5050" } },
        ],
      },
      select: {
        id: true,
        orderNo: true,
        status: true,
        productModelSnapshot: true,
        productNameSnapshot: true,
      },
      take: 8,
    });
    expect(result.results).toContainEqual({
      type: "production-order",
      id: "production-order-1",
      title: "MO-2026-001",
      subtitle: "BK5050 插床 · ISSUED",
      href: "/erp/production-orders",
      group: "生产工单",
    });
  });
});
