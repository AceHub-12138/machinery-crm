import { prisma } from "@/lib/db";
import { buildCustomerWhereClause, canSeeAllData, type SessionUser } from "@/lib/permissions";
import { isInventoryBelowWarningThreshold, resolveInventoryWarningThreshold } from "@/lib/inventory-alert";
import { DomainError } from "@/modules/shared/domain-error";

export type UnifiedTask = {
  id: string; sourceType: string; sourceId: string; module: "CRM" | "ERP" | "SYSTEM"; taskType: string; title: string; description?: string; status: string; priority: "LOW" | "NORMAL" | "HIGH" | "URGENT"; initiatorId?: string; assigneeId?: string; dueAt?: string; createdAt: string; href: string; state?: { readAt: Date | null; pinnedAt: Date | null; ignoredAt: Date | null };
};

const makeId = (sourceType: string, sourceId: string) => `${sourceType}:${sourceId}`;

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export async function listUnifiedTasks(user: SessionUser, view = "inbox") {
  const isAdmin = canSeeAllData(user);
  const canSeeErpTasks = isAdmin || user.role === "PURCHASE" || user.role === "WAREHOUSE";
  const canSeeCrmTasks = isAdmin || user.role === "SALES" || user.role === "FOREIGN_TRADE";
  const today = startOfToday();
  const upcoming = addDays(today, 3);
  const customerWhere = buildCustomerWhereClause(user);
  const [unlocks, deletes, changes, demands, purchaseDeletes, kitDeletes, followUps, purchaseOrders, supplierDeliveryItems, inventoryRows, shipments, overdueProductionOrders] = await Promise.all([
    prisma.contractUnlockRequest.findMany({ where: view === "initiated" ? { requesterId: user.id } : view === "approval" && isAdmin ? { status: "PENDING" } : { OR: [{ requesterId: user.id }, ...(isAdmin ? [{ status: "PENDING" as const }] : [])] }, select: { id: true, requesterId: true, status: true, reason: true, createdAt: true, contractId: true } }),
    prisma.contractDeleteRequest.findMany({ where: view === "initiated" ? { requesterId: user.id } : view === "approval" && isAdmin ? { status: "PENDING" } : { OR: [{ requesterId: user.id }, ...(isAdmin ? [{ status: "PENDING" as const }] : [])] }, select: { id: true, requesterId: true, status: true, reason: true, createdAt: true, contractId: true } }),
    canSeeErpTasks ? prisma.productionOrderChangeRequest.findMany({ where: view === "initiated" ? { requesterId: user.id } : view === "approval" && isAdmin ? { status: "PENDING" } : { OR: [{ requesterId: user.id }, ...(isAdmin ? [{ status: "PENDING" as const }] : [])] }, select: { id: true, requesterId: true, status: true, reason: true, createdAt: true, productionOrderId: true } }) : Promise.resolve([]),
    canSeeErpTasks ? prisma.purchaseDemand.findMany({ where: { activeSlot: true, status: { in: ["DRAFT", "SUBMITTED"] } }, select: { id: true, demandNo: true, status: true, sourceLabel: true, createdAt: true, needByDate: true, createdById: true } }) : Promise.resolve([]),
    canSeeErpTasks ? prisma.purchaseOrderDeleteRequest.findMany({ where: view === "initiated" ? { requesterId: user.id } : view === "approval" && isAdmin ? { status: "PENDING" } : { OR: [{ requesterId: user.id }, ...(isAdmin ? [{ status: "PENDING" as const }] : [])] }, select: { id: true, purchaseOrderId: true, requesterId: true, status: true, reason: true, createdAt: true } }) : Promise.resolve([]),
    canSeeErpTasks ? prisma.kitCheckDeleteRequest.findMany({ where: view === "initiated" ? { requesterId: user.id } : view === "approval" && isAdmin ? { status: "PENDING" } : { OR: [{ requesterId: user.id }, ...(isAdmin ? [{ status: "PENDING" as const }] : [])] }, select: { id: true, kitCheckResultId: true, requesterId: true, status: true, reason: true, createdAt: true } }) : Promise.resolve([]),
    canSeeCrmTasks ? prisma.customer.findMany({ where: { ...customerWhere, status: { notIn: ["WON", "LOST", "INACTIVE"] }, nextFollowDate: { lte: upcoming } }, select: { id: true, companyName: true, nextFollowDate: true, assignedUserId: true, createdAt: true }, orderBy: { nextFollowDate: "asc" } }) : Promise.resolve([]),
    canSeeErpTasks ? prisma.purchaseOrder.findMany({ where: { deletedAt: null, status: { in: ["ORDERED", "PARTIAL_RECEIVED"] } }, select: { id: true, orderNo: true, supplierNameSnapshot: true, createdAt: true } }) : Promise.resolve([]),
    canSeeErpTasks ? prisma.purchaseOrderItem.findMany({ where: { latestPromisedDate: { not: null, lte: upcoming }, deliveryStatus: { notIn: ["FULLY_RECEIVED", "CLOSED"] } }, select: { id: true, purchaseOrderId: true, materialNameSnapshot: true, latestPromisedDate: true, createdAt: true }, orderBy: { latestPromisedDate: "asc" } }) : Promise.resolve([]),
    canSeeErpTasks ? prisma.inventory.findMany({ select: { id: true, quantity: true, createdAt: true, warehouse: { select: { name: true } }, material: { select: { id: true, code: true, name: true, safetyStock: true, safetyStockEnabled: true, category: { select: { warningThreshold: true } } } } } }) : Promise.resolve([]),
    canSeeCrmTasks ? prisma.shipment.findMany({ where: { shipmentDate: { lt: today }, shipmentStatus: { not: "SHIPPED" }, contract: { deletedAt: null, customer: customerWhere } }, select: { id: true, shipmentDate: true, shipmentStatus: true, createdAt: true, contract: { select: { id: true, contractNo: true, customer: { select: { companyName: true } } } } }, orderBy: { shipmentDate: "asc" } }) : Promise.resolve([]),
    canSeeErpTasks ? prisma.productionOrder.findMany({ where: { deletedAt: null, isCurrent: true, status: "ISSUED", plannedDate: { lt: today } }, select: { id: true, orderNo: true, productNameSnapshot: true, plannedDate: true, createdAt: true }, orderBy: { plannedDate: "asc" } }) : Promise.resolve([]),
  ]);
  const orderById = new Map(purchaseOrders.map((order) => [order.id, order]));
  const delayedDeliveryItems = supplierDeliveryItems.filter((item) => orderById.has(item.purchaseOrderId));
  const tasks: UnifiedTask[] = [
    ...unlocks.map((row) => ({ id: makeId("ContractUnlockRequest", row.id), sourceType: "ContractUnlockRequest", sourceId: row.id, module: "CRM" as const, taskType: "CONTRACT_UNLOCK", title: "合同修改审批", description: row.reason, status: row.status, priority: "HIGH" as const, initiatorId: row.requesterId, assigneeId: isAdmin ? user.id : undefined, createdAt: row.createdAt.toISOString(), href: "/contract-unlock-requests" })),
    ...deletes.map((row) => ({ id: makeId("ContractDeleteRequest", row.id), sourceType: "ContractDeleteRequest", sourceId: row.id, module: "CRM" as const, taskType: "CONTRACT_DELETE", title: "合同删除审批", description: row.reason, status: row.status, priority: "URGENT" as const, initiatorId: row.requesterId, assigneeId: isAdmin ? user.id : undefined, createdAt: row.createdAt.toISOString(), href: "/contract-delete-requests" })),
    ...changes.map((row) => ({ id: makeId("ProductionOrderChangeRequest", row.id), sourceType: "ProductionOrderChangeRequest", sourceId: row.id, module: "ERP" as const, taskType: "PRODUCTION_ORDER_CHANGE", title: "生产工单变更审批", description: row.reason, status: row.status, priority: "HIGH" as const, initiatorId: row.requesterId, assigneeId: isAdmin ? user.id : undefined, createdAt: row.createdAt.toISOString(), href: "/erp/production-order-change-requests" })),
    ...demands.map((row) => ({ id: makeId("PurchaseDemand", row.id), sourceType: "PurchaseDemand", sourceId: row.id, module: "ERP" as const, taskType: "PURCHASE_DEMAND", title: `采购需求：${row.demandNo}`, description: row.sourceLabel, status: row.status, priority: new Date(row.needByDate).getTime() < Date.now() + 3 * 86400000 ? "HIGH" as const : "NORMAL" as const, initiatorId: row.createdById, dueAt: row.needByDate.toISOString(), createdAt: row.createdAt.toISOString(), href: "/erp/purchase-demands" })),
    ...purchaseDeletes.map((row) => ({ id: makeId("PurchaseOrderDeleteRequest", row.id), sourceType: "PurchaseOrderDeleteRequest", sourceId: row.id, module: "ERP" as const, taskType: "PURCHASE_ORDER_DELETE", title: "采购订单删除审批", description: row.reason, status: row.status, priority: "URGENT" as const, initiatorId: row.requesterId, assigneeId: isAdmin ? user.id : undefined, createdAt: row.createdAt.toISOString(), href: "/tasks" })),
    ...kitDeletes.map((row) => ({ id: makeId("KitCheckDeleteRequest", row.id), sourceType: "KitCheckDeleteRequest", sourceId: row.id, module: "ERP" as const, taskType: "KIT_CHECK_DELETE", title: "齐套结果删除审批", description: row.reason, status: row.status, priority: "HIGH" as const, initiatorId: row.requesterId, assigneeId: isAdmin ? user.id : undefined, createdAt: row.createdAt.toISOString(), href: "/tasks" })),
    ...followUps.map((row) => ({ id: makeId("CustomerFollowUp", row.id), sourceType: "CustomerFollowUp", sourceId: row.id, module: "CRM" as const, taskType: "CUSTOMER_FOLLOW_UP", title: `客户跟进：${row.companyName}`, description: row.nextFollowDate && row.nextFollowDate < today ? "跟进计划已逾期" : "跟进计划即将到期", status: "PENDING", priority: row.nextFollowDate && row.nextFollowDate < today ? "URGENT" as const : "NORMAL" as const, assigneeId: row.assignedUserId || undefined, dueAt: row.nextFollowDate?.toISOString(), createdAt: row.createdAt.toISOString(), href: `/customers/${row.id}` })),
    ...delayedDeliveryItems.map((row) => {
      const order = orderById.get(row.purchaseOrderId)!;
      const overdue = row.latestPromisedDate! < today;
      return { id: makeId("SupplierDelivery", row.id), sourceType: "SupplierDelivery", sourceId: row.id, module: "ERP" as const, taskType: "SUPPLIER_DELIVERY_DELAY", title: `供应商交期：${order.orderNo}`, description: `${order.supplierNameSnapshot} · ${row.materialNameSnapshot}`, status: "PENDING", priority: overdue ? "URGENT" as const : "NORMAL" as const, dueAt: row.latestPromisedDate!.toISOString(), createdAt: row.createdAt.toISOString(), href: "/erp/supplier-deliveries" };
    }),
    ...inventoryRows.filter((row) => isInventoryBelowWarningThreshold(row.quantity, row.material)).map((row) => ({ id: makeId("InventoryLowStock", row.id), sourceType: "InventoryLowStock", sourceId: row.id, module: "ERP" as const, taskType: "INVENTORY_LOW_STOCK", title: `库存预警：${row.material.name}`, description: `${row.warehouse.name} 当前库存 ${Number(row.quantity)}，预警阈值 ${resolveInventoryWarningThreshold(row.material)}`, status: "PENDING", priority: "HIGH" as const, createdAt: row.createdAt.toISOString(), href: "/erp/inventory?alertOnly=1" })),
    ...shipments.map((row) => ({ id: makeId("ShipmentOverdue", row.id), sourceType: "ShipmentOverdue", sourceId: row.id, module: "CRM" as const, taskType: "SHIPMENT_OVERDUE", title: `发货逾期：${row.contract.contractNo}`, description: `${row.contract.customer.companyName} · 计划发货日已过`, status: "PENDING", priority: "URGENT" as const, dueAt: row.shipmentDate.toISOString(), createdAt: row.createdAt.toISOString(), href: "/shipments" })),
    ...overdueProductionOrders.map((row) => ({ id: makeId("ProductionOrderOverdue", row.id), sourceType: "ProductionOrderOverdue", sourceId: row.id, module: "ERP" as const, taskType: "PRODUCTION_ORDER_OVERDUE", title: `生产工单逾期：${row.orderNo}`, description: `${row.productNameSnapshot} · 计划完工日已过`, status: "PENDING", priority: "HIGH" as const, dueAt: row.plannedDate!.toISOString(), createdAt: row.createdAt.toISOString(), href: "/erp/production-orders" })),
  ];
  const states = await prisma.systemUserTaskState.findMany({ where: { userId: user.id, sourceType: { in: tasks.map((task) => task.sourceType) }, sourceId: { in: tasks.map((task) => task.sourceId) } } });
  const stateByKey = new Map(states.map((state) => [makeId(state.sourceType, state.sourceId), state]));
  const withState = tasks.map((task) => ({ ...task, state: stateByKey.get(task.id) }));
  return view === "handled" ? withState.filter((task) => task.state?.readAt || task.status !== "PENDING") : withState.filter((task) => !task.state?.ignoredAt).sort((a, b) => Number(Boolean(b.state?.pinnedAt)) - Number(Boolean(a.state?.pinnedAt)) || b.createdAt.localeCompare(a.createdAt));
}

export async function updateTaskState(user: SessionUser, input: { sourceType: string; sourceId: string; action: "READ" | "PIN" | "IGNORE" | "UNIGNORE" }) {
  if (!input.sourceType || !input.sourceId) throw new DomainError("待办来源不能为空", 400);
  const visibleTasks = await listUnifiedTasks(user, "all");
  if (!visibleTasks.some((task) => task.sourceType === input.sourceType && task.sourceId === input.sourceId)) throw new DomainError("无权更新该待办状态", 403);
  const now = new Date();
  const data = input.action === "READ" ? { readAt: now, lastViewedAt: now } : input.action === "PIN" ? { pinnedAt: now } : input.action === "IGNORE" ? { ignoredAt: now } : { ignoredAt: null };
  return prisma.systemUserTaskState.upsert({ where: { userId_sourceType_sourceId: { userId: user.id, sourceType: input.sourceType, sourceId: input.sourceId } }, create: { userId: user.id, sourceType: input.sourceType, sourceId: input.sourceId, ...data }, update: data });
}
