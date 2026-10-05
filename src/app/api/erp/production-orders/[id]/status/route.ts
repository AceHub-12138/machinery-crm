import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canPublishProductionOrder, getSessionUser } from "@/lib/permissions";
import { getProductionOrderDetail, ProductionOrderRequestError } from "@/lib/production-orders";
import { writeOperationLog } from "@/lib/sales-items";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canPublishProductionOrder(user)) return NextResponse.json({ error: "无权限取消生产工单" }, { status: 403 });
  const { id } = await params;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "请求数据格式错误" }, { status: 400 }); }
  if (body.status !== "CANCELLED") return NextResponse.json({ error: "生产工单仅支持作废操作；已发布工单如需修改请提交变更申请" }, { status: 400 });
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.productionOrder.findFirst({ where: { id, deletedAt: null, isCurrent: true } });
      if (!existing) throw new ProductionOrderRequestError("生产工单不存在", 404);
      if (existing.status !== "ISSUED") throw new ProductionOrderRequestError("仅已发布工单可以作废", 409);
      const [stockOuts, stockIns] = await Promise.all([
        tx.stockOut.findMany({ where: { productionOrderId: id }, include: { items: true } }),
        tx.stockIn.findMany({ where: { productionOrderId: id, status: "CONFIRMED" }, include: { items: true } }),
      ]);
      const issued = stockOuts.reduce((sum, document) => sum + document.items.reduce((itemSum, item) => itemSum + Number(item.quantity), 0), 0);
      const returned = stockIns.reduce((sum, document) => sum + document.items.reduce((itemSum, item) => itemSum + Number(item.quantity), 0), 0);
      if (issued > returned) throw new ProductionOrderRequestError("工单仍有净领料，请先退料使净领料数量归零后再取消", 409);
      const changed = await tx.productionOrder.updateMany({ where: { id, status: "ISSUED", isCurrent: true, deletedAt: null }, data: { status: "CANCELLED" } });
      if (changed.count !== 1) throw new ProductionOrderRequestError("生产工单已被其他操作更新，请刷新后重试", 409);
      await writeOperationLog(tx, { userId: user.id, action: "CANCEL_PRODUCTION_ORDER", entityType: "ProductionOrder", entityId: id, beforeData: { status: existing.status }, afterData: { status: "CANCELLED", netIssued: issued - returned } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof ProductionOrderRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  return NextResponse.json(await getProductionOrderDetail(id));
}
