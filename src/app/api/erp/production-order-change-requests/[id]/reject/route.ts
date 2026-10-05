import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { ProductionOrderRequestError } from "@/lib/production-orders";
import { writeOperationLog } from "@/lib/sales-items";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isSuperAdmin(user)) return NextResponse.json({ error: "仅超级管理员可以驳回工单变更" }, { status: 403 });
  const { id } = await params;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "请求数据格式错误" }, { status: 400 }); }
  const remark = String(body.remark || "").trim();
  if (!remark) return NextResponse.json({ error: "请填写驳回原因" }, { status: 400 });
  try {
    const requestRecord = await prisma.$transaction(async (tx) => {
      const current = await tx.productionOrderChangeRequest.findUnique({ where: { id }, include: { productionOrder: true } });
      if (!current) throw new ProductionOrderRequestError("工单变更申请不存在", 404);
      if (current.status !== "PENDING" || current.productionOrder.status !== "CHANGE_PENDING") throw new ProductionOrderRequestError("该变更申请已经处理或工单状态已变化", 409);
      const restored = await tx.productionOrder.updateMany({ where: { id: current.productionOrderId, status: "CHANGE_PENDING", isCurrent: true }, data: { status: "ISSUED" } });
      if (restored.count !== 1) throw new ProductionOrderRequestError("当前工单已被其他操作更新，请刷新后重试", 409);
      const rejected = await tx.productionOrderChangeRequest.update({ where: { id }, data: { status: "REJECTED", approverId: user.id, approvalRemark: remark, rejectedAt: new Date() } });
      await writeOperationLog(tx, { userId: user.id, action: "REJECT_PRODUCTION_ORDER_CHANGE_REQUEST", entityType: "ProductionOrder", entityId: current.productionOrderId, beforeData: { status: "CHANGE_PENDING" }, afterData: { status: "ISSUED", changeRequestId: rejected.id, remark } });
      return rejected;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(requestRecord);
  } catch (error) {
    if (error instanceof ProductionOrderRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
