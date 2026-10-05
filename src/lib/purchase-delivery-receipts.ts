import { Prisma } from "@prisma/client";

export async function allocatePurchaseReceiptToBatches(tx: Prisma.TransactionClient, input: { purchaseOrderItemId: string; stockInItemId: string; quantity: Prisma.Decimal.Value; arrivedAt: Date }) {
  let remaining = new Prisma.Decimal(input.quantity);
  const batches = await tx.purchaseDeliveryBatch.findMany({ where: { purchaseOrderItemId: input.purchaseOrderItemId }, orderBy: { createdAt: "asc" } });
  for (const batch of batches) {
    if (remaining.lte(0)) break;
    const open = Prisma.Decimal.max(new Prisma.Decimal(batch.plannedQuantity).sub(batch.receivedQuantity), 0);
    const applied = Prisma.Decimal.min(open, remaining);
    if (applied.lte(0)) continue;
    await tx.purchaseDeliveryBatch.update({ where: { id: batch.id }, data: { receivedQuantity: { increment: applied }, actualArrivalDate: new Prisma.Decimal(batch.receivedQuantity).add(applied).gte(batch.plannedQuantity) ? input.arrivedAt : batch.actualArrivalDate } });
    await tx.purchaseDeliveryReceiptAllocation.create({ data: { deliveryBatchId: batch.id, stockInItemId: input.stockInItemId, quantity: applied } });
    remaining = remaining.sub(applied);
  }
  if (remaining.gt(0)) {
    const batch = await tx.purchaseDeliveryBatch.create({ data: { purchaseOrderItemId: input.purchaseOrderItemId, plannedQuantity: remaining, receivedQuantity: remaining, actualArrivalDate: input.arrivedAt, remark: "采购入库自动登记批次" } });
    await tx.purchaseDeliveryReceiptAllocation.create({ data: { deliveryBatchId: batch.id, stockInItemId: input.stockInItemId, quantity: remaining } });
  }
}

export async function reversePurchaseReceiptBatches(tx: Prisma.TransactionClient, stockInItemId: string) {
  const allocations = await tx.purchaseDeliveryReceiptAllocation.findMany({ where: { stockInItemId }, include: { deliveryBatch: true } });
  for (const allocation of allocations) {
    const after = Prisma.Decimal.max(new Prisma.Decimal(allocation.deliveryBatch.receivedQuantity).sub(allocation.quantity), 0);
    await tx.purchaseDeliveryBatch.update({ where: { id: allocation.deliveryBatchId }, data: { receivedQuantity: after, actualArrivalDate: after.gte(allocation.deliveryBatch.plannedQuantity) ? allocation.deliveryBatch.actualArrivalDate : null } });
  }
  await tx.purchaseDeliveryReceiptAllocation.deleteMany({ where: { stockInItemId } });
}
