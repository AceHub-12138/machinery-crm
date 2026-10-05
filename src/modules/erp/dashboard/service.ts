import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/permissions";
import { resolveInventoryWarningThreshold } from "@/lib/inventory-alert";
import { canSeeInventoryAmount, canSeeProcurementDetails, resolveErpDashboardView } from "./permissions";
import type { DashboardSection, ErpDashboardResponse } from "./types";

const day = 24 * 60 * 60 * 1000;
const asNumber = (value: unknown) => Number(value || 0);
const section = async <T>(load: () => Promise<T>): Promise<DashboardSection<T>> => {
  try { return { data: await load() }; } catch (error) { console.error("[erp.dashboard.section]", error); return { error: "统计数据暂时不可用" }; }
};

export async function getErpDashboard(user: SessionUser): Promise<ErpDashboardResponse> {
  const roleView = resolveErpDashboardView(user); const today = new Date(); today.setHours(0, 0, 0, 0); const inSevenDays = new Date(today.getTime() + 7 * day); const staleBefore = new Date(today.getTime() - 90 * day);
  const production = section(async () => {
    const base = { deletedAt: null, isCurrent: true }; const issued = { ...base, status: "ISSUED" as const };
    const dueSoonWhere = { ...issued, OR: [{ deliveryDateSnapshot: { gte: today, lt: inSevenDays } }, { deliveryDateSnapshot: null, plannedDate: { gte: today, lt: inSevenDays } }] };
    const [inProgress, dueSoon, overdue, pendingKitCheck, draft, changePending, cancelled, riskTotal, shortageTotal] = await Promise.all([
      prisma.productionOrder.count({ where: issued }), prisma.productionOrder.count({ where: dueSoonWhere }), prisma.productionOrder.count({ where: { ...issued, OR: [{ deliveryDateSnapshot: { lt: today } }, { deliveryDateSnapshot: null, plannedDate: { lt: today } }] } }), prisma.productionOrder.count({ where: { ...base, status: { not: "CANCELLED" }, OR: [{ kitCheckStatus: "NOT_CHECKED" }, { kitCheckRequired: true, kitCheckStatus: { not: "SUFFICIENT" } }] } }), prisma.productionOrder.count({ where: { ...base, status: "DRAFT" } }), prisma.productionOrder.count({ where: { ...base, status: "CHANGE_PENDING" } }), prisma.productionOrder.count({ where: { ...base, status: "CANCELLED" } }), prisma.productionOrder.count({ where: { ...issued, OR: [{ deliveryDateSnapshot: { lt: inSevenDays } }, { deliveryDateSnapshot: null, plannedDate: { lt: inSevenDays } }] } }), prisma.productionOrder.count({ where: { ...base, status: { not: "CANCELLED" }, kitCheckStatus: "SHORTAGE" } })
    ]);
    return { kpis: { inProgress, dueSoon, overdue, pendingKitCheck }, statusDistribution: { DRAFT: draft, ISSUED: inProgress, CHANGE_PENDING: changePending, CANCELLED: cancelled }, totals: { riskOrders: riskTotal, shortageOrders: shortageTotal } };
  });
  const kitCheck = section(async () => {
    const kitBase = { deletedAt: null, isCurrent: true, status: { not: "CANCELLED" as const } }; const [sufficient, shortage, notChecked] = await Promise.all([prisma.productionOrder.count({ where: { ...kitBase, kitCheckStatus: "SUFFICIENT" } }), prisma.productionOrder.count({ where: { ...kitBase, kitCheckStatus: "SHORTAGE" } }), prisma.productionOrder.count({ where: { ...kitBase, kitCheckStatus: "NOT_CHECKED" } })]);
    const total = sufficient + shortage + notChecked; return { total, sufficient, shortage, notChecked, rate: total ? Number(((sufficient / total) * 100).toFixed(1)) : null, formula: "完全齐套工单 ÷ 已纳入统计的未删除当前工单 × 100%" };
  });
  const procurement = section(async () => {
    const orderWhere: Prisma.PurchaseOrderWhereInput = roleView === "WAREHOUSE" ? { deletedAt: null, status: { in: ["ORDERED", "PARTIAL_RECEIVED"] } } : { deletedAt: null };
    const [demands, orders, delayedItems] = await Promise.all([prisma.purchaseDemand.count({ where: { status: { in: ["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_CONVERTED"] } } }), prisma.purchaseOrder.findMany({ where: orderWhere, select: { id: true, orderNo: true, status: true, expectedArrivalDate: true, supplierNameSnapshot: true }, orderBy: { createdAt: "desc" }, take: 100 }), prisma.purchaseOrderItem.count({ where: { deliveryStatus: { in: ["OVERDUE_NOT_RECEIVED", "OVERDUE_PARTIAL_RECEIVED"] } } })]);
    const items = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: { in: orders.map((order) => order.id) } }, select: { id: true, purchaseOrderId: true, materialCodeSnapshot: true, materialNameSnapshot: true, quantity: true, receivedQuantity: true, latestPromisedDate: true, deliveryStatus: true } });
    const itemsByOrder = new Map<string, typeof items>(); for (const item of items) itemsByOrder.set(item.purchaseOrderId, [...(itemsByOrder.get(item.purchaseOrderId) || []), item]);
    const visibleOrders = orders.map((order) => ({ id: order.id, orderNo: order.orderNo, status: order.status, expectedArrivalDate: order.expectedArrivalDate, supplier: order.supplierNameSnapshot, items: (itemsByOrder.get(order.id) || []).map((item) => ({ id: item.id, materialCode: item.materialCodeSnapshot, materialName: item.materialNameSnapshot, pendingQuantity: asNumber(item.quantity) - asNumber(item.receivedQuantity), latestPromisedDate: item.latestPromisedDate, deliveryStatus: item.deliveryStatus })) }));
    return { pendingDemands: demands, delayedItems, orders: visibleOrders, mode: canSeeProcurementDetails(roleView) ? "DETAIL" : "RECEIVING_ONLY" };
  });
  const inventory = section(async () => {
    const showAmount = canSeeInventoryAmount(roleView);
    // 预警口径与库存台账/统一待办共用 resolveInventoryWarningThreshold(物料启用安全库存优先,否则分类预警线)。
    const rows = await prisma.inventory.findMany({ select: { warehouseId: true, quantity: true, ...(showAmount ? { totalAmount: true } : {}), material: { select: { id: true, code: true, name: true, unit: true, safetyStock: true, safetyStockEnabled: true, category: { select: { warningThreshold: true } } } }, warehouse: { select: { id: true, name: true, code: true } } } });
    const zeroCount = rows.filter((row) => asNumber(row.quantity) <= 0).length;
    const activeMaterialIds = new Set<string>(); const alertRows: Array<{ materialId: string; code: string; name: string; unit: string; warehouseId: string; warehouse: string; quantity: number; threshold: number; gap: number }> = []; let inventoryValue = 0;
    const statsByWarehouse = new Map<string, { kinds: number; alertCount: number; value: number }>();
    for (const row of rows) {
      const quantity = asNumber(row.quantity); const threshold = resolveInventoryWarningThreshold(row.material); const isAlert = threshold !== null && quantity <= threshold;
      const stat = statsByWarehouse.get(row.warehouseId) || { kinds: 0, alertCount: 0, value: 0 };
      if (quantity > 0) { activeMaterialIds.add(row.material.id); stat.kinds += 1; }
      if (showAmount) { inventoryValue += asNumber(row.totalAmount); stat.value += asNumber(row.totalAmount); }
      if (isAlert) stat.alertCount += 1;
      statsByWarehouse.set(row.warehouseId, stat);
      if (isAlert) alertRows.push({ materialId: row.material.id, code: row.material.code, name: row.material.name, unit: row.material.unit, warehouseId: row.warehouseId, warehouse: row.warehouse.name, quantity, threshold, gap: threshold - quantity });
    }
    const warehouses = await prisma.warehouse.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true }, orderBy: [{ code: "asc" }, { name: "asc" }] });
    const warehouseSummaries = warehouses.map((warehouse) => { const stat = statsByWarehouse.get(warehouse.id) || { kinds: 0, alertCount: 0, value: 0 }; return { id: warehouse.id, name: warehouse.name, code: warehouse.code, kinds: stat.kinds, alertCount: stat.alertCount, ...(showAmount ? { value: stat.value } : {}) }; });
    alertRows.sort((a, b) => b.gap - a.gap || a.name.localeCompare(b.name, "zh-CN"));
    const [pendingChecks, staleMaterials] = await Promise.all([prisma.stockCheck.count({ where: { status: { in: ["DRAFT", "CHECKING"] } } }), prisma.material.count({ where: { deletedAt: null, inventories: { some: {} }, movements: { none: { createdAt: { gte: staleBefore } } } } })]);
    return { totalItems: rows.length, activeKinds: activeMaterialIds.size, alertCount: alertRows.length, zeroCount, ...(showAmount ? { inventoryValue } : {}), pendingChecks, staleMaterials, warehouses: warehouseSummaries, alerts: alertRows.slice(0, 8) };
  });
  const movements = section(async () => {
    const rows = await prisma.stockMovement.findMany({ orderBy: { createdAt: "desc" }, take: 8, select: { id: true, type: true, quantity: true, createdAt: true, material: { select: { name: true, code: true, unit: true } }, warehouse: { select: { name: true } } } });
    return { items: rows.map((row) => ({ id: row.id, type: row.type, quantity: asNumber(row.quantity), unit: row.material.unit, materialName: row.material.name, materialCode: row.material.code, warehouse: row.warehouse.name, createdAt: row.createdAt.toISOString() })) };
  });
  const alerts = section(async () => {
    const [pendingStockIn, recentErpVoids] = await Promise.all([prisma.purchaseOrder.count({ where: { deletedAt: null, status: { in: ["ORDERED", "PARTIAL_RECEIVED"] } } }), roleView === "ADMIN" ? prisma.operationLog.count({ where: { action: { contains: "VOID" }, entityType: { in: ["StockIn", "StockOut", "StockCheck", "PurchaseOrder"] }, createdAt: { gte: new Date(today.getTime() - 30 * day) } } }) : Promise.resolve(null)]);
    return { pendingStockIn, ...(recentErpVoids === null ? {} : { recentVoids: recentErpVoids }) };
  });
  return { roleView, generatedAt: new Date().toISOString(), production: await production, kitCheck: await kitCheck, procurement: await procurement, inventory: await inventory, movements: await movements, alerts: await alerts };
}
