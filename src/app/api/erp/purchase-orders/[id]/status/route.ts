import { NextRequest, NextResponse } from "next/server";
import { PurchaseOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, canManagePurchaseOrders } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { releaseShortageSource } from "@/lib/purchase-order-shortage-source";
import { releasePurchaseDemandAllocations } from "@/lib/purchase-demand-links";

const ALLOWED_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  DRAFT: ["ORDERED", "CANCELLED"],
  // Arrival states are derived exclusively from confirmed stock-in records.
  ORDERED: ["CANCELLED"],
  PARTIAL_RECEIVED: [],
  RECEIVED: [],
  CANCELLED: [],
};

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: "草稿",
  ORDERED: "已下单",
  PARTIAL_RECEIVED: "部分到货",
  RECEIVED: "已到货",
  CANCELLED: "已取消",
};

function isPurchaseOrderStatus(value: unknown): value is PurchaseOrderStatus {
  return typeof value === "string" && value in ALLOWED_TRANSITIONS;
}

async function loadPurchaseOrder(id: string) {
  const order = await prisma.purchaseOrder.findFirst({ where: { id, deletedAt: null } });
  if (!order) return null;
  const [items, supplier] = await Promise.all([
    prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: id }, orderBy: { sortOrder: "asc" } }),
    prisma.supplier.findUnique({ where: { id: order.supplierId }, select: { id: true, name: true, isActive: true } }),
  ]);
  return { ...order, items, supplier };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canManagePurchaseOrders(user)) return NextResponse.json({ error: "无权限变更采购订单状态" }, { status: 403 });

  const { id } = await params;
  const body = await request.json();
  const targetStatus = body?.status;
  if (!isPurchaseOrderStatus(targetStatus)) {
    return NextResponse.json({ error: "采购订单目标状态无效" }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.purchaseOrder.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new Error("采购订单不存在");
      if (!ALLOWED_TRANSITIONS[existing.status].includes(targetStatus)) {
        throw new Error(`采购订单当前为${STATUS_LABELS[existing.status]}，不能变更为${STATUS_LABELS[targetStatus]}`);
      }

      // Compare-and-set avoids two concurrent requests advancing the same order twice.
      const result = await tx.purchaseOrder.updateMany({
        where: { id, status: existing.status, deletedAt: null },
        data: { status: targetStatus },
      });
      if (result.count !== 1) throw new Error("采购订单状态已被其他操作更新，请刷新后重试");
      const releasedDemandAllocations = targetStatus === "CANCELLED" ? await releasePurchaseDemandAllocations(tx, id) : 0;
      const releasedSources = targetStatus === "CANCELLED"
        ? await tx.purchaseOrderShortageSource.updateMany({ where: { purchaseOrderId: id, isActive: true }, data: releaseShortageSource(new Date()) })
        : { count: 0 };

      const after = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!after) throw new Error("采购订单不存在");
      await writeOperationLog(tx, {
        userId: user.id,
        action: "UPDATE_PURCHASE_ORDER_STATUS",
        entityType: "PurchaseOrder",
        entityId: id,
        beforeData: { status: existing.status },
        afterData: { status: after.status, releasedShortageSourceCount: releasedSources.count, releasedDemandAllocations },
      });
    });
    return NextResponse.json(await loadPurchaseOrder(id));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (error.message === "采购订单不存在") return NextResponse.json({ error: error.message }, { status: 404 });
    if (error.message === "采购订单状态已被其他操作更新，请刷新后重试") {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
