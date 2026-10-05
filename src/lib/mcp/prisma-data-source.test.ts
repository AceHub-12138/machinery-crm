import { describe, expect, it, vi } from "vitest";
import { createPrismaMcpDataSource } from "@/lib/mcp/prisma-data-source";
import type { McpUser } from "@/lib/mcp/application";
import { MCP_TOOL_NAMES } from "@/lib/mcp/tools";

const salesUser: McpUser = {
  id: "sales-1",
  name: "山东销售",
  email: "sales@example.com",
  role: "SALES",
  region: "山东",
  territories: [{ province: "山东省", cities: ["济南市"] }],
  viewScope: "TERRITORY",
};

describe("Prisma MCP data source", () => {
  it("returns an empty paginated lead list and pushes every approved filter into Prisma", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const dataSource = createPrismaMcpDataSource({ lead: { findMany, count } } as never);
    const adminUser: McpUser = { ...salesUser, id: "admin-1", role: "SUPER_ADMIN", viewScope: "ALL" };

    const result = await dataSource.execute("lead_list", {
      page: 2,
      pageSize: 2,
      reviewStatus: "PENDING",
      source: "BAIDU_SEARCH",
      searchKeyword: "数控机床",
      aiScoreMin: 60,
      aiScoreMax: 90,
      dateStart: "2026-08-01",
      dateEnd: "2026-08-14",
    }, adminUser);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        reviewStatus: "PENDING",
        source: "BAIDU_SEARCH",
        searchKeyword: { contains: "数控机床" },
        aiScore: { gte: 60, lte: 90 },
        createdAt: {
          gte: new Date("2026-08-01T00:00:00.000Z"),
          lt: new Date("2026-08-15T00:00:00.000Z"),
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 2,
      take: 2,
    }));
    expect(result).toEqual({
      items: [],
      pagination: { page: 2, pageSize: 2, total: 0, totalPages: 0 },
    });
  });

  it("returns lead detail with profile and immutable feedback events", async () => {
    const leadId = "11111111-1111-4111-8111-111111111111";
    const lead = {
      id: leadId,
      companyName: "测试机床公司",
      aiScore: 88,
      profile: { industry: "机床制造" },
      reviewStatus: "HIGH_INTENT",
      feedbackVersion: 1,
    };
    const feedbackEvents = [{
      id: "22222222-2222-4222-8222-222222222222",
      leadId,
      reviewStatus: "HIGH_INTENT",
      reviewReasonCode: "MISMATCH",
      comment: "需要人工复核",
      reviewedByUserId: "33333333-3333-4333-8333-333333333333",
      reviewedAt: new Date("2026-08-14T01:00:00.000Z"),
    }];
    const findUnique = vi.fn().mockResolvedValue(lead);
    const findMany = vi.fn().mockResolvedValue(feedbackEvents);
    const dataSource = createPrismaMcpDataSource({
      lead: { findUnique },
      leadFeedbackEvent: { findMany },
    } as never);
    const adminUser: McpUser = { ...salesUser, id: "admin-1", role: "SUPER_ADMIN", viewScope: "ALL" };

    const result = await dataSource.execute("lead_get", { id: leadId }, adminUser);

    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: leadId },
      select: expect.objectContaining({ profile: true, aiScore: true, feedbackVersion: true }),
    }));
    expect(findMany).toHaveBeenCalledWith({
      where: { leadId },
      select: {
        id: true,
        leadId: true,
        reviewStatus: true,
        reviewReasonCode: true,
        comment: true,
        reviewedByUserId: true,
        reviewedAt: true,
      },
      orderBy: [{ reviewedAt: "desc" }, { id: "desc" }],
    });
    expect(result).toEqual({
      ...lead,
      feedbackEvents: [{ ...feedbackEvents[0], reviewedAt: "2026-08-14T01:00:00.000Z" }],
    });
  });

  it("returns stable lead distributions including zero-filled categories and score bands", async () => {
    const groupBy = vi.fn(async (input: { by: string[] }) => {
      if (input.by[0] === "reviewStatus") {
        return [
          { reviewStatus: "PENDING", _count: { _all: 2 } },
          { reviewStatus: "HIGH_INTENT", _count: { _all: 1 } },
        ];
      }
      if (input.by[0] === "source") {
        return [
          { source: "BAIDU_SEARCH", _count: { _all: 2 } },
          { source: "MANUAL", _count: { _all: 1 } },
        ];
      }
      return [
        { aiScore: null, _count: { _all: 1 } },
        { aiScore: 35, _count: { _all: 1 } },
        { aiScore: 72, _count: { _all: 1 } },
        { aiScore: 95, _count: { _all: 1 } },
      ];
    });
    const dataSource = createPrismaMcpDataSource({
      lead: { count: vi.fn().mockResolvedValue(4), groupBy },
    } as never);
    const adminUser: McpUser = { ...salesUser, id: "admin-1", role: "SUPER_ADMIN", viewScope: "ALL" };

    const result = await dataSource.execute("lead_stats", {}, adminUser);

    expect(result).toEqual({
      total: 4,
      byReviewStatus: [
        { reviewStatus: "PENDING", count: 2 },
        { reviewStatus: "HIGH_INTENT", count: 1 },
        { reviewStatus: "MID_INTENT", count: 0 },
        { reviewStatus: "LOW_INTENT", count: 0 },
        { reviewStatus: "INVALID", count: 0 },
      ],
      bySource: [
        { source: "BAIDU_SEARCH", count: 2 },
        { source: "MANUAL", count: 1 },
        { source: "OTHER", count: 0 },
      ],
      byAiScoreBand: [
        { band: "UNSCORED", min: null, max: null, count: 1 },
        { band: "0_39", min: 0, max: 39, count: 1 },
        { band: "40_59", min: 40, max: 59, count: 0 },
        { band: "60_79", min: 60, max: 79, count: 1 },
        { band: "80_100", min: 80, max: 100, count: 1 },
      ],
    });
    expect(groupBy).toHaveBeenCalledTimes(3);
  });

  it("returns a stable zero-filled lead stats shape for an empty pool", async () => {
    const dataSource = createPrismaMcpDataSource({
      lead: {
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
      },
    } as never);
    const adminUser: McpUser = { ...salesUser, id: "admin-1", role: "SUPER_ADMIN", viewScope: "ALL" };

    const result = await dataSource.execute("lead_stats", {}, adminUser) as {
      total: number;
      byReviewStatus: Array<{ count: number }>;
      bySource: Array<{ count: number }>;
      byAiScoreBand: Array<{ count: number }>;
    };

    expect(result.total).toBe(0);
    expect(result.byReviewStatus.every(({ count }) => count === 0)).toBe(true);
    expect(result.bySource.every(({ count }) => count === 0)).toBe(true);
    expect(result.byAiScoreBand.every(({ count }) => count === 0)).toBe(true);
  });

  it.each(["lead_list", "lead_get", "lead_stats"])("denies SALES from calling %s before Prisma is called", async (toolName) => {
    const leadFindMany = vi.fn();
    const dataSource = createPrismaMcpDataSource({ lead: { findMany: leadFindMany } } as never);

    await expect(dataSource.execute(toolName, {}, salesUser)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "当前角色无权调用此工具",
    });
    expect(leadFindMany).not.toHaveBeenCalled();
  });

  it("applies the existing business-line and territory isolation to customer queries", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const dataSource = createPrismaMcpDataSource({
      customer: { findMany, count },
    } as never);

    const result = await dataSource.execute("crm_customers_list", {
      page: 1,
      pageSize: 20,
      search: "机床",
    }, salesUser);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        deletedAt: null,
        businessLine: "国内销售",
        OR: [{ province: "山东省", city: { in: ["济南市"] } }],
        AND: [{
          OR: [
            { companyName: { contains: "机床" } },
            { contactName: { contains: "机床" } },
            { phone: { contains: "机床" } },
            { email: { contains: "机床" } },
          ],
        }],
      }),
      skip: 0,
      take: 20,
    }));
    expect(result).toEqual({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
  });

  it("denies every ERP query to CRM-only roles before Prisma is called", async () => {
    const supplierFindMany = vi.fn();
    const dataSource = createPrismaMcpDataSource({
      supplier: { findMany: supplierFindMany },
    } as never);

    await expect(dataSource.execute("erp_suppliers_list", {
      page: 1,
      pageSize: 20,
    }, salesUser)).rejects.toEqual(expect.objectContaining({
      code: "FORBIDDEN",
      message: "当前角色无权调用此工具",
    }));
    expect(supplierFindMany).not.toHaveBeenCalled();
  });

  it("keeps warehouse purchase-order visibility limited to submitted orders", async () => {
    const findMany = vi.fn();
    const dataSource = createPrismaMcpDataSource({ purchaseOrder: { findMany } } as never);
    const warehouseUser: McpUser = { ...salesUser, id: "warehouse-1", role: "WAREHOUSE" };

    await expect(dataSource.execute("erp_purchase_orders_list", {
      page: 1,
      pageSize: 20,
      status: "DRAFT",
    }, warehouseUser)).rejects.toEqual(expect.objectContaining({
      code: "FORBIDDEN",
      message: "仓库管理只能查看已提交或已批准的采购订单",
    }));
    expect(findMany).not.toHaveBeenCalled();
  });

  it("calculates kit readiness from frozen materials and inventory without persisting business data", async () => {
    const kitCreate = vi.fn();
    const productionUpdate = vi.fn();
    const operationLogCreate = vi.fn();
    const dataSource = createPrismaMcpDataSource({
      productionOrder: {
        findFirst: vi.fn().mockResolvedValue({
          id: "po-1",
          orderNo: "PO-001",
          warehouseId: "warehouse-1",
          status: "ISSUED",
          quantity: 1,
          bomVersionSnapshot: "v1",
        }),
        update: productionUpdate,
      },
      productionOrderMaterial: {
        findMany: vi.fn().mockResolvedValue([{
          materialId: "material-1",
          materialCodeSnapshot: "M-001",
          materialNameSnapshot: "测试物料",
          materialSpecSnapshot: "10mm",
          unitSnapshot: "件",
          perUnitQuantity: 10,
          requiredQuantity: 10,
        }]),
      },
      inventory: {
        findMany: vi.fn().mockResolvedValue([{ materialId: "material-1", quantity: 4 }]),
      },
      purchaseOrder: { findMany: vi.fn().mockResolvedValue([]) },
      purchaseOrderItem: { findMany: vi.fn() },
      stockOut: { findMany: vi.fn().mockResolvedValue([{ items: [{ materialId: "material-1", quantity: 2 }] }]) },
      stockIn: { findMany: vi.fn().mockResolvedValue([{ items: [{ materialId: "material-1", quantity: 1 }] }]) },
      kitCheckResult: { create: kitCreate },
      operationLog: { create: operationLogCreate },
    } as never);
    const adminUser: McpUser = { ...salesUser, id: "admin-1", role: "SUPER_ADMIN" };

    const result = await dataSource.execute("erp_kit_check", { productionOrderId: "po-1" }, adminUser);

    expect(result).toMatchObject({
      productionOrderId: "po-1",
      status: "SHORTAGE",
      shortageCount: 1,
      persisted: false,
      detail: [{
        materialId: "material-1",
        totalRequiredQty: 10,
        remainingRequiredQty: 9,
        availableQty: 4,
        shortageQty: 5,
      }],
    });
    expect(kitCreate).not.toHaveBeenCalled();
    expect(productionUpdate).not.toHaveBeenCalled();
    expect(operationLogCreate).not.toHaveBeenCalled();
  });

  it("records only the minimal audit identity and status fields", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const queryExecuteRaw = vi.fn();
    const dataSource = createPrismaMcpDataSource(
      { $executeRaw: queryExecuteRaw } as never,
      { $executeRaw: executeRaw } as never,
    );

    await dataSource.writeAudit({
      requestId: "request-1",
      userId: "audit-user-1",
      apiKeyName: "fastgpt",
      method: "tools/call",
      toolName: "crm_customers_list",
      success: true,
      statusCode: 200,
      durationMs: 12,
      createdAt: new Date("2026-07-17T08:00:00.000Z"),
    });

    expect(executeRaw).toHaveBeenCalledTimes(1);
    const serializedCall = JSON.stringify(executeRaw.mock.calls);
    expect(serializedCall).toContain("audit-user-1");
    expect(serializedCall).toContain("request-1");
    expect(serializedCall).toContain("crm_customers_list");
    expect(serializedCall).not.toMatch(/argument|search|authorization|password/i);
    expect(queryExecuteRaw).not.toHaveBeenCalled();
  });

  it("keeps the product list aligned with the existing active-product query", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const dataSource = createPrismaMcpDataSource({
      product: { findMany, count: vi.fn().mockResolvedValue(0) },
    } as never);

    await dataSource.execute("crm_products_list", { page: 1, pageSize: 20 }, salesUser);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true } }));
  });

  it("applies customer isolation to both contract and shipment queries", async () => {
    const contractFindMany = vi.fn().mockResolvedValue([]);
    const shipmentFindMany = vi.fn().mockResolvedValue([]);
    const dataSource = createPrismaMcpDataSource({
      contract: { findMany: contractFindMany, count: vi.fn().mockResolvedValue(0) },
      shipment: { findMany: shipmentFindMany, count: vi.fn().mockResolvedValue(0) },
    } as never);

    await dataSource.execute("crm_contracts_list", {}, salesUser);
    await dataSource.execute("crm_shipments_list", {}, salesUser);

    const isolation = {
      businessLine: "国内销售",
      OR: [{ province: "山东省", city: { in: ["济南市"] } }],
    };
    expect(contractFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { deletedAt: null, customer: isolation } }));
    expect(shipmentFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { contract: { deletedAt: null, customer: isolation } } }));
  });

  it("pushes customer isolation into the follow-record query itself", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const dataSource = createPrismaMcpDataSource({
      followRecord: { findMany, count },
    } as never);

    await dataSource.execute("crm_customer_follows_list", { customerId: "customer-1" }, salesUser);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        customerId: "customer-1",
        customer: {
          deletedAt: null,
          businessLine: "国内销售",
          OR: [{ province: "山东省", city: { in: ["济南市"] } }],
        },
      },
      skip: 0,
      take: 20,
    }));
  });

  it("pushes inventory alert thresholds and pagination into Prisma", async () => {
    const materialFindMany = vi.fn().mockResolvedValue([
      { id: "material-low", safetyStock: 5, category: { warningThreshold: 2 } },
      { id: "material-category-low", safetyStock: null, category: { warningThreshold: 2 } },
    ]);
    const inventoryFindMany = vi.fn().mockResolvedValue([
      { id: "low", quantity: 4, material: { safetyStock: 5, category: { warningThreshold: 2 } } },
      { id: "category-low", quantity: 2, material: { safetyStock: null, category: { warningThreshold: 2 } } },
    ]);
    const dataSource = createPrismaMcpDataSource({
      material: {
        findMany: materialFindMany,
      },
      inventory: {
        findMany: inventoryFindMany,
        count: vi.fn().mockResolvedValue(2),
      },
    } as never);

    const result = await dataSource.execute("erp_inventory_list", {
      alertOnly: true,
      warehouseId: "warehouse-1",
      search: "轴承",
      dateStart: "2026-07-01",
      dateEnd: "2026-07-31",
      page: 1,
      pageSize: 20,
    }, { ...salesUser, role: "WAREHOUSE" });

    expect(result).toMatchObject({
      items: [{ id: "low" }, { id: "category-low" }],
      pagination: { total: 2 },
    });
    expect(materialFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [{ name: { contains: "轴承" } }, { code: { contains: "轴承" } }],
        AND: [
          {
            OR: [
              { safetyStock: { not: null } },
              { safetyStock: null, category: { warningThreshold: { not: null } } },
            ],
          },
          {
            inventories: {
              some: {
                warehouseId: "warehouse-1",
                updatedAt: {
                  gte: new Date("2026-07-01T00:00:00.000Z"),
                  lt: new Date("2026-08-01T00:00:00.000Z"),
                },
              },
            },
          },
        ],
      }),
      orderBy: { id: "asc" },
      take: 501,
    }));
    expect(inventoryFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        warehouseId: "warehouse-1",
        updatedAt: {
          gte: new Date("2026-07-01T00:00:00.000Z"),
          lt: new Date("2026-08-01T00:00:00.000Z"),
        },
        material: {
          deletedAt: null,
          isActive: true,
          OR: [{ name: { contains: "轴承" } }, { code: { contains: "轴承" } }],
        },
        OR: [
          { materialId: "material-low", quantity: { lte: 5 } },
          { materialId: "material-category-low", quantity: { lte: 2 } },
        ],
      }),
      skip: 0,
      take: 20,
    }));
  });

  it("rejects an unbounded inventory alert candidate set before building a large SQL OR", async () => {
    const inventoryFindMany = vi.fn();
    const dataSource = createPrismaMcpDataSource({
      material: {
        findMany: vi.fn().mockResolvedValue(Array.from({ length: 501 }, (_, index) => ({
          id: `material-${index}`,
          safetyStock: 1,
          category: { warningThreshold: null },
        }))),
      },
      inventory: {
        findMany: inventoryFindMany,
        count: vi.fn(),
      },
    } as never);

    await expect(dataSource.execute("erp_inventory_list", { alertOnly: true }, { ...salesUser, role: "WAREHOUSE" }))
      .rejects.toMatchObject({ code: "QUERY_SCOPE_TOO_LARGE" });
    expect(inventoryFindMany).not.toHaveBeenCalled();
  });

  it("uses fixed filters for stock documents and movement queries", async () => {
    const stockInFindMany = vi.fn().mockResolvedValue([]);
    const movementFindMany = vi.fn().mockResolvedValue([]);
    const dataSource = createPrismaMcpDataSource({
      stockIn: { findMany: stockInFindMany, count: vi.fn().mockResolvedValue(0) },
      stockMovement: { findMany: movementFindMany, count: vi.fn().mockResolvedValue(0) },
    } as never);
    const warehouseUser: McpUser = { ...salesUser, role: "WAREHOUSE" };

    await dataSource.execute("erp_stock_documents_list", {
      direction: "IN",
      warehouseId: "warehouse-1",
      productionOrderId: "production-1",
      purchaseOrderId: "purchase-1",
    }, warehouseUser);
    await dataSource.execute("erp_stock_movements_list", {
      warehouseId: "warehouse-1",
      materialId: "material-1",
      type: "STOCK_IN",
      refType: "StockIn",
      refId: "stock-in-1",
    }, warehouseUser);

    expect(stockInFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { warehouseId: "warehouse-1", productionOrderId: "production-1", purchaseOrderId: "purchase-1" },
    }));
    expect(movementFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { warehouseId: "warehouse-1", materialId: "material-1", type: "STOCK_IN", refType: "StockIn", refId: "stock-in-1" },
    }));
  });

  it("preserves BOM-detail and supplier-detail role restrictions", async () => {
    const bomFindFirst = vi.fn();
    const supplierFindFirst = vi.fn();
    const dataSource = createPrismaMcpDataSource({
      bomHeader: { findFirst: bomFindFirst },
      supplier: { findFirst: supplierFindFirst },
    } as never);

    await expect(dataSource.execute("erp_bom_get", { id: "bom-1" }, { ...salesUser, role: "PURCHASE" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(dataSource.execute("erp_bom_get", { id: "bom-1" }, { ...salesUser, role: "WAREHOUSE" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(dataSource.execute("erp_supplier_get", { id: "supplier-1" }, { ...salesUser, role: "WAREHOUSE" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(bomFindFirst).not.toHaveBeenCalled();
    expect(supplierFindFirst).not.toHaveBeenCalled();
  });

  it("keeps MCP kit-check restricted to SUPER_ADMIN when the UI allows warehouse execution", async () => {
    const dataSource = createPrismaMcpDataSource({} as never);

    await expect(dataSource.execute(
      "erp_kit_check",
      { productionOrderId: "production-1" },
      { ...salesUser, role: "WAREHOUSE" },
    )).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns the restricted production-order view for purchase users", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      id: "production-1",
      orderNo: "PO-001",
      productModelSnapshot: "DC-100",
      productNameSnapshot: "测试设备",
      quantity: 1,
      plannedDate: new Date("2026-08-01"),
      status: "ISSUED",
      kitCheckResults: [],
    }]);
    const dataSource = createPrismaMcpDataSource({
      productionOrder: {
        findMany,
        count: vi.fn().mockResolvedValue(1),
      },
    } as never);

    const result = await dataSource.execute("erp_production_orders_list", {}, { ...salesUser, role: "PURCHASE" }) as { items: Array<Record<string, unknown>> };

    expect(result.items[0]).toMatchObject({ id: "production-1", orderNo: "PO-001", productModelSnapshot: "DC-100", status: "ISSUED" });
    expect(result.items[0]).not.toHaveProperty("contractId");
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty("contractId");
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty("bomId");
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty("warehouseId");
  });

  it("combines warehouse purchase-order record id and status scope in one Prisma where", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const dataSource = createPrismaMcpDataSource({ purchaseOrder: { findFirst } } as never);

    await expect(dataSource.execute("erp_purchase_order_get", { id: "purchase-1" }, { ...salesUser, role: "WAREHOUSE" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: "purchase-1",
      deletedAt: null,
      status: { in: ["ORDERED", "PARTIAL_RECEIVED", "RECEIVED"] },
    } }));
  });

  it("pushes date limits into Prisma where and caps returned list size", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const dataSource = createPrismaMcpDataSource({ customer: { findMany, count } } as never);

    await dataSource.execute("crm_customers_list", {
      page: 2,
      pageSize: 100,
      dateStart: "2026-01-01",
      dateEnd: "2026-01-31",
    }, salesUser);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ createdAt: {
        gte: new Date("2026-01-01T00:00:00.000Z"),
        lt: new Date("2026-02-01T00:00:00.000Z"),
      } }),
      skip: 100,
      take: 100,
    }));
  });

  it("keeps customer classification separate from lifecycle status in the Prisma where clause", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const dataSource = createPrismaMcpDataSource({ customer: { findMany, count } } as never);

    await dataSource.execute("crm_customers_list", {
      customerType: "NEW",
      status: "NEW_LEAD",
    }, salesUser);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        customerType: "NEW",
        status: "NEW_LEAD",
      }),
    }));
  });

  it("keeps two sales users' business line and territory scopes isolated concurrently", async () => {
    const captured: unknown[] = [];
    const findMany = vi.fn(async (input: unknown) => { captured.push(input); return []; });
    const dataSource = createPrismaMcpDataSource({ customer: { findMany, count: vi.fn().mockResolvedValue(0) } } as never);
    const foreignTrade: McpUser = {
      ...salesUser,
      id: "foreign-1",
      role: "FOREIGN_TRADE",
      territories: [{ province: "海外", cities: [] }],
    };

    await Promise.all([
      dataSource.execute("crm_customers_list", {}, salesUser),
      dataSource.execute("crm_customers_list", {}, foreignTrade),
    ]);

    expect(captured).toEqual(expect.arrayContaining([
      expect.objectContaining({ where: expect.objectContaining({
        businessLine: "国内销售",
        OR: [{ province: "山东省", city: { in: ["济南市"] } }],
      }) }),
      expect.objectContaining({ where: expect.objectContaining({
        businessLine: "外贸",
        OR: [{ province: "海外" }],
      }) }),
    ]));
  });

  it("reloads only trusted user identity fields and excludes password data", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "sales-1",
      isActive: true,
      role: "SALES",
      region: "山东",
      territories: [],
      viewScope: "TERRITORY",
    });
    const dataSource = createPrismaMcpDataSource({ user: { findUnique } } as never);

    await dataSource.findUser!("sales-1");

    const select = findUnique.mock.calls[0][0].select;
    expect(select).toEqual({
      id: true,
      isActive: true,
      role: true,
      region: true,
      territories: true,
      viewScope: true,
    });
    expect(select).not.toHaveProperty("password");
  });

  it("dispatches every published tool to a fixed implementation", async () => {
    const model = new Proxy({}, {
      get: (_target, method) => vi.fn().mockResolvedValue(
        method === "count" ? 0 : ["findFirst", "findUnique", "findUniqueOrThrow"].includes(String(method)) ? null : [],
      ),
    });
    const client = new Proxy({}, { get: () => model });
    const dataSource = createPrismaMcpDataSource(client as never);
    const admin: McpUser = { ...salesUser, id: "admin-1", role: "SUPER_ADMIN" };
    const argsByTool: Record<string, Record<string, unknown>> = {
      lead_list: {},
      lead_get: { id: "11111111-1111-4111-8111-111111111111" },
      lead_stats: {},
      crm_customers_list: {},
      crm_customer_get: { id: "missing" },
      crm_customer_follows_list: { customerId: "missing" },
      crm_products_list: {},
      crm_product_get: { id: "missing" },
      crm_contracts_list: {},
      crm_contract_get: { id: "missing" },
      crm_shipments_list: {},
      crm_shipment_get: { id: "missing" },
      erp_suppliers_list: {},
      erp_supplier_get: { id: "missing" },
      erp_purchase_orders_list: {},
      erp_purchase_order_get: { id: "missing" },
      erp_inventory_list: {},
      erp_stock_documents_list: { direction: "IN" },
      erp_stock_movements_list: {},
      erp_boms_list: {},
      erp_bom_get: { id: "missing" },
      erp_production_orders_list: {},
      erp_production_order_get: { id: "missing" },
      erp_kit_check: { productionOrderId: "missing" },
    };

    const outcomes = await Promise.all(MCP_TOOL_NAMES.map(async (toolName) => {
      try {
        await dataSource.execute(toolName, argsByTool[toolName], admin);
        return "OK";
      } catch (error) {
        return (error as { code?: string }).code || "UNEXPECTED";
      }
    }));

    expect(outcomes).not.toContain("UNKNOWN_TOOL");
    expect(outcomes).not.toContain("UNEXPECTED");
  });
});
