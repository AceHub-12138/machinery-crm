import { Prisma, PurchaseOrderStatus } from "@prisma/client";
import { writeOperationLog } from "@/lib/sales-items";

type LockedPurchaseOrder = {
  id: string;
  status: PurchaseOrderStatus;
  deletedAt: Date | null;
};

type LockedPurchaseOrderItem = {
  id: string;
  purchaseOrderId: string;
  materialId: string;
  quantity: Prisma.Decimal | string | number;
  receivedQuantity: Prisma.Decimal | string | number;
};

export type PurchaseReceiptLine = {
  purchaseOrderItemId: string;
  materialId: string;
  quantity: Prisma.Decimal;
};

export class PurchaseReceiptError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

function decimal(value: Prisma.Decimal | string | number) {
  return new Prisma.Decimal(value);
}

async function lockPurchaseOrder(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string
): Promise<{ order: LockedPurchaseOrder; items: LockedPurchaseOrderItem[] }> {
  const orders = await tx.$queryRaw<LockedPurchaseOrder[]>(
    Prisma.sql`SELECT id, status, deletedAt FROM erp_purchase_orders WHERE id = ${purchaseOrderId} FOR UPDATE`
  );
  const order = orders[0];
  if (!order || order.deletedAt) throw new PurchaseReceiptError("采购订单不存在", 404);

  const items = await tx.$queryRaw<LockedPurchaseOrderItem[]>(
    Prisma.sql`SELECT id, purchaseOrderId, materialId, quantity, receivedQuantity FROM erp_purchase_order_items WHERE purchaseOrderId = ${purchaseOrderId} ORDER BY id FOR UPDATE`
  );
  if (items.length === 0) throw new PurchaseReceiptError("采购订单没有可入库的明细");

  return { order, items };
}

export async function lockAndValidatePurchaseReceipt(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
  receiptLines: PurchaseReceiptLine[]
) {
  const { order, items } = await lockPurchaseOrder(tx, purchaseOrderId);
  if (order.status !== "ORDERED" && order.status !== "PARTIAL_RECEIVED") {
    throw new PurchaseReceiptError("只有已下单或部分到货状态的采购订单可以生成入库单");
  }

  const itemById = new Map(items.map((item) => [item.id, item]));
  for (const line of receiptLines) {
    const purchaseItem = itemById.get(line.purchaseOrderItemId);
    if (!purchaseItem || purchaseItem.purchaseOrderId !== purchaseOrderId) {
      throw new PurchaseReceiptError("入库明细关联的采购订单明细不属于当前采购订单");
    }
    if (purchaseItem.materialId !== line.materialId) {
      throw new PurchaseReceiptError("入库物料与采购订单明细不一致");
    }
    const remaining = decimal(purchaseItem.quantity).minus(decimal(purchaseItem.receivedQuantity));
    if (line.quantity.greaterThan(remaining)) {
      throw new PurchaseReceiptError("入库数量超过采购订单明细的剩余到货数量");
    }
  }

  return { order, items };
}

function statusForReceivedItems(items: LockedPurchaseOrderItem[]): PurchaseOrderStatus {
  if (items.every((item) => decimal(item.receivedQuantity).greaterThanOrEqualTo(decimal(item.quantity)))) {
    return "RECEIVED";
  }
  if (items.some((item) => decimal(item.receivedQuantity).greaterThan(0))) {
    return "PARTIAL_RECEIVED";
  }
  return "ORDERED";
}

export async function reconcilePurchaseOrderReceiptStatus(
  tx: Prisma.TransactionClient,
  input: {
    purchaseOrderId: string;
    currentStatus: PurchaseOrderStatus;
    userId: string;
  }
) {
  const items = await tx.purchaseOrderItem.findMany({
    where: { purchaseOrderId: input.purchaseOrderId },
    select: { id: true, purchaseOrderId: true, materialId: true, quantity: true, receivedQuantity: true },
    orderBy: { id: "asc" },
  });
  const targetStatus = statusForReceivedItems(items);
  if (targetStatus === input.currentStatus) return targetStatus;

  // This is a system reconciliation after a receipt/link change. It intentionally permits
  // corrective reverse transitions that remain unavailable from the Part B manual API.
  const result = await tx.purchaseOrder.updateMany({
    where: { id: input.purchaseOrderId, status: input.currentStatus, deletedAt: null },
    data: { status: targetStatus },
  });
  if (result.count !== 1) {
    throw new PurchaseReceiptError("采购订单状态已被其他操作更新，请刷新后重试", 409);
  }

  await writeOperationLog(tx, {
    userId: input.userId,
    action: "AUTO_UPDATE_PURCHASE_ORDER_STATUS",
    entityType: "PurchaseOrder",
    entityId: input.purchaseOrderId,
    beforeData: { status: input.currentStatus },
    afterData: { status: targetStatus },
  });
  return targetStatus;
}

export async function lockPurchaseOrderForUnlink(tx: Prisma.TransactionClient, purchaseOrderId: string) {
  return lockPurchaseOrder(tx, purchaseOrderId);
}
