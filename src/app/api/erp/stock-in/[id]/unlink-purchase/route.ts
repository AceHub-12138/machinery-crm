import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, canManageInventory } from "@/lib/permissions";
import {
  lockPurchaseOrderForUnlink,
  PurchaseReceiptError,
  reconcilePurchaseOrderReceiptStatus,
} from "@/lib/purchase-order-receipt";
import { writeOperationLog } from "@/lib/sales-items";
import { reversePurchaseReceiptBatches } from "@/lib/purchase-delivery-receipts";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canManageInventory(user)) return NextResponse.json({ error: "无权限操作入库" }, { status: 403 });

  const { id } = await params;
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const initial = await tx.stockIn.findUnique({
          where: { id },
          select: { id: true, purchaseOrderId: true },
        });
        if (!initial) throw new PurchaseReceiptError("入库单不存在", 404);
        if (!initial.purchaseOrderId) throw new PurchaseReceiptError("该入库单未关联采购订单");

        const purchaseOrderId = initial.purchaseOrderId;
        const locked = await lockPurchaseOrderForUnlink(tx, purchaseOrderId);
        const stockIn = await tx.stockIn.findUnique({
          where: { id },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        });
        if (!stockIn) throw new PurchaseReceiptError("入库单不存在", 404);
        if (stockIn.purchaseOrderId !== purchaseOrderId) {
          throw new PurchaseReceiptError("该入库单的采购关联已被其他操作撤销，请刷新后重试", 409);
        }

        const latest = await tx.stockIn.findFirst({
          where: { purchaseOrderId },
          select: { id: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        if (!latest || latest.id !== id) {
          throw new PurchaseReceiptError("只能撤销该采购订单最近一次关联的入库单", 409);
        }

        const purchaseItemById = new Map(locked.items.map((item) => [item.id, item]));
        for (const item of stockIn.items) {
          if (!item.purchaseOrderItemId) {
            throw new PurchaseReceiptError("入库单采购关联数据不完整，无法撤销", 409);
          }
          const purchaseItem = purchaseItemById.get(item.purchaseOrderItemId);
          if (!purchaseItem || purchaseItem.materialId !== item.materialId) {
            throw new PurchaseReceiptError("入库单采购关联数据不一致，无法撤销", 409);
          }
          if (new Prisma.Decimal(purchaseItem.receivedQuantity).lessThan(item.quantity)) {
            throw new PurchaseReceiptError("采购订单已到货数量异常，无法撤销", 409);
          }
        }

        for (const item of stockIn.items) {
          await reversePurchaseReceiptBatches(tx, item.id);
          const purchaseItem = purchaseItemById.get(item.purchaseOrderItemId!);
          const receivedAfter = new Prisma.Decimal(purchaseItem!.receivedQuantity).sub(item.quantity);
          await tx.purchaseOrderItem.update({
            where: { id: item.purchaseOrderItemId! },
            data: { receivedQuantity: { decrement: item.quantity }, deliveryStatus: receivedAfter.lte(0) ? "NOT_DELIVERED" : "PARTIAL_RECEIVED", actualArrivalDate: null },
          });
          let remaining = new Prisma.Decimal(item.quantity);
          const sources = await tx.purchaseOrderItemSource.findMany({ where: { purchaseOrderItemId: item.purchaseOrderItemId! }, orderBy: { createdAt: "desc" } });
          for (const source of sources) { if (remaining.lte(0)) break; const reversed = Prisma.Decimal.min(source.fulfilledQuantity, remaining); if (reversed.gt(0)) await tx.purchaseOrderItemSource.update({ where: { id: source.id }, data: { fulfilledQuantity: { decrement: reversed } } }); remaining = remaining.sub(reversed); }
        }
        await tx.stockInItem.updateMany({
          where: { stockInId: id },
          data: { purchaseOrderItemId: null },
        });
        await tx.stockIn.update({ where: { id }, data: { purchaseOrderId: null } });
        const status = await reconcilePurchaseOrderReceiptStatus(tx, {
          purchaseOrderId,
          currentStatus: locked.order.status,
          userId: user.id,
        });

        await writeOperationLog(tx, {
          userId: user.id,
          action: "UNLINK_PURCHASE_ORDER_FROM_STOCK_IN",
          entityType: "StockIn",
          entityId: id,
          beforeData: {
            purchaseOrderId,
            itemCount: stockIn.items.length,
            purchaseOrderStatus: locked.order.status,
          },
          afterData: {
            purchaseOrderId: null,
            purchaseOrderStatus: status,
          },
        });

        return { id, purchaseOrderId, status };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PurchaseReceiptError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const prismaError = error as { code?: string; message?: string };
    if (prismaError?.code === "P2034" || /deadlock|serialization/i.test(String(prismaError?.message))) {
      return NextResponse.json({ error: "操作太频繁，请重试" }, { status: 409 });
    }
    throw error;
  }
}
