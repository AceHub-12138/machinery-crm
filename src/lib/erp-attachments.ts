import { prisma } from "@/lib/db";
import { canManageDeliveryItem } from "@/lib/supplier-delivery";
import type { SessionUser } from "@/lib/permissions";
import { canSeeAllData, customerIsolationWhere } from "@/lib/customer-permissions";
import { canAccessAfterSales } from "@/lib/after-sales";

export async function attachmentEntityExists(entityType: string, entityId: string) {
  if (entityType === "STOCK_IN") return Boolean(await prisma.stockIn.findUnique({ where: { id: entityId }, select: { id: true } }));
  if (entityType === "STOCK_OUT") return Boolean(await prisma.stockOut.findUnique({ where: { id: entityId }, select: { id: true } }));
  if (entityType === "DELIVERY_FOLLOW_UP") return Boolean(await prisma.supplierDeliveryFollowUp.findUnique({ where: { id: entityId }, select: { id: true } }));
  if (entityType === "PROMISE_DATE") return Boolean(await prisma.supplierPromiseDateHistory.findUnique({ where: { id: entityId }, select: { id: true } }));
  if (entityType === "DELIVERY_BATCH") return Boolean(await prisma.purchaseDeliveryBatch.findUnique({ where: { id: entityId }, select: { id: true } }));
  if (entityType === "AFTER_SALES_ORDER") return Boolean(await prisma.afterSalesOrder.findFirst({ where: { id: entityId, deletedAt: null }, select: { id: true } }));
  return false;
}

export async function canModifyAttachmentEntity(user: SessionUser, entityType: string, entityId: string) {
  if (entityType === "AFTER_SALES_ORDER") {
    if (!canAccessAfterSales(user)) return false;
    return Boolean(await prisma.afterSalesOrder.findFirst({ where: { id: entityId, deletedAt: null, customer: canSeeAllData(user) ? {} : customerIsolationWhere(user) }, select: { id: true } }));
  }
  if (["STOCK_IN", "STOCK_OUT"].includes(entityType)) return user.role === "SUPER_ADMIN" || user.role === "WAREHOUSE";
  let itemId: string | null = null;
  if (entityType === "DELIVERY_FOLLOW_UP") itemId = (await prisma.supplierDeliveryFollowUp.findUnique({ where: { id: entityId }, select: { purchaseOrderItemId: true } }))?.purchaseOrderItemId || null;
  if (entityType === "PROMISE_DATE") itemId = (await prisma.supplierPromiseDateHistory.findUnique({ where: { id: entityId }, select: { purchaseOrderItemId: true } }))?.purchaseOrderItemId || null;
  if (entityType === "DELIVERY_BATCH") itemId = (await prisma.purchaseDeliveryBatch.findUnique({ where: { id: entityId }, select: { purchaseOrderItemId: true } }))?.purchaseOrderItemId || null;
  if (!itemId) return false;
  const item = await prisma.purchaseOrderItem.findUnique({ where: { id: itemId } });
  if (!item) return false;
  const order = await prisma.purchaseOrder.findUnique({ where: { id: item.purchaseOrderId }, select: { createdById: true } });
  return Boolean(order && canManageDeliveryItem(user, item, order));
}

export async function canViewAttachmentEntity(user: SessionUser, entityType: string, entityId: string) {
  if (await canModifyAttachmentEntity(user, entityType, entityId)) return true;
  if (entityType !== "STOCK_IN" || user.role !== "PURCHASE") return false;
  const stockIn = await prisma.stockIn.findUnique({ where: { id: entityId }, select: { purchaseOrderId: true } });
  if (!stockIn?.purchaseOrderId) return false;
  const [order, responsibleItem] = await Promise.all([
    prisma.purchaseOrder.findUnique({ where: { id: stockIn.purchaseOrderId }, select: { createdById: true } }),
    prisma.purchaseOrderItem.findFirst({ where: { purchaseOrderId: stockIn.purchaseOrderId, responsibleId: user.id }, select: { id: true } }),
  ]);
  return Boolean(order && (order.createdById === user.id || responsibleItem));
}
