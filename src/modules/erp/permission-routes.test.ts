import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSessionUser: vi.fn(), canManagePurchaseDemands: vi.fn(), canManagePurchaseOrders: vi.fn(), findMany: vi.fn(), transaction: vi.fn(), upsert: vi.fn(), writeOperationLog: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ getSessionUser: mocks.getSessionUser, canManagePurchaseDemands: mocks.canManagePurchaseDemands, canManagePurchaseOrders: mocks.canManagePurchaseOrders }));
vi.mock("@/lib/db", () => ({ prisma: { purchaseDemand: { findMany: mocks.findMany }, $transaction: mocks.transaction } }));
vi.mock("@/lib/procurement-planning", () => ({ upsertPurchaseDemandForSource: mocks.upsert }));
vi.mock("@/lib/sales-items", () => ({ writeOperationLog: mocks.writeOperationLog }));

import { GET as demandGet, POST as demandPost } from "@/app/api/erp/purchase-demands/route";
import { POST as orderPost } from "@/app/api/erp/purchase-orders/route";

const warehouse = { id: "warehouse", role: "WAREHOUSE", region: "", territories: [], viewScope: "TERRITORY" };
describe("仓库权限 BUG 路由契约", () => {
  it("WAREHOUSE 可以读取采购需求", async () => {
    mocks.getSessionUser.mockResolvedValue(warehouse); mocks.canManagePurchaseDemands.mockReturnValue(true); mocks.findMany.mockResolvedValue([]);
    const response = await demandGet(new NextRequest("http://localhost/api/erp/purchase-demands"));
    expect(response.status).toBe(200);
  });
  it("WAREHOUSE 可以创建采购需求", async () => {
    mocks.getSessionUser.mockResolvedValue(warehouse); mocks.canManagePurchaseDemands.mockReturnValue(true); mocks.transaction.mockImplementation(async (run: any) => run({})); mocks.upsert.mockResolvedValue({ id: "d1" });
    const response = await demandPost(new NextRequest("http://localhost/api/erp/purchase-demands", { method: "POST", body: JSON.stringify({ sourceType: "MANUAL", materialId: "m1", quantity: "1", needByDate: "2026-08-04" }) }));
    expect(response.status).toBe(201);
  });
  it("WAREHOUSE 不能创建采购订单", async () => {
    mocks.getSessionUser.mockResolvedValue(warehouse); mocks.canManagePurchaseOrders.mockReturnValue(false);
    const response = await orderPost(new NextRequest("http://localhost/api/erp/purchase-orders", { method: "POST", body: "{}" }));
    expect(response.status).toBe(403);
  });
});
