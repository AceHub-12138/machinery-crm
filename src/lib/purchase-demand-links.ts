import { Prisma } from "@prisma/client";
export async function releasePurchaseDemandAllocations(tx: Prisma.TransactionClient, purchaseOrderId: string) {
  const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId }, select: { id: true } });
  const sources = await tx.purchaseOrderItemSource.findMany({ where: { purchaseOrderItemId: { in: items.map((item) => item.id) } }, include: { purchaseDemand: true } });
  for (const source of sources) {
    if (source.fulfilledQuantity.gt(0)) throw new Error("采购明细已有到货核销，不能直接取消；请走冲销或纠错流程");
    const convertedQuantity = Prisma.Decimal.max(new Prisma.Decimal(source.purchaseDemand.convertedQuantity).sub(source.allocatedQuantity), 0);
    await tx.purchaseDemand.update({ where: { id: source.purchaseDemandId }, data: { convertedQuantity, status: source.purchaseDemand.approvedById ? "APPROVED" : "DRAFT", activeSlot: true } });
  }
  return sources.length;
}
