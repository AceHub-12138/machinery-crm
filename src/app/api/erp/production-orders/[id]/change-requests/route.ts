import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canPublishProductionOrder, getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { buildDraftData, normalizeDraftInput, ProductionOrderRequestError } from "@/lib/production-orders";
import { toPlainJson, writeOperationLog } from "@/lib/sales-items";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isSuperAdmin(user)) return NextResponse.json({ error: "无权限查看工单变更记录" }, { status: 403 });
  const { id } = await params;
  return NextResponse.json(await prisma.productionOrderChangeRequest.findMany({ where: { productionOrderId: id }, orderBy: { createdAt: "desc" } }));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canPublishProductionOrder(user)) return NextResponse.json({ error: "无权限提交工单变更申请" }, { status: 403 });
  const { id } = await params;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "请求数据格式错误" }, { status: 400 }); }
  const reason = String(body.reason || "").trim();
  if (!reason) return NextResponse.json({ error: "请填写变更原因" }, { status: 400 });
  try {
    const changeRequest = await prisma.$transaction(async (tx) => {
      const current = await tx.productionOrder.findFirst({ where: { id, deletedAt: null, isCurrent: true } });
      if (!current) throw new ProductionOrderRequestError("生产工单不存在", 404);
      if (current.status !== "ISSUED") throw new ProductionOrderRequestError("仅已发布工单可以申请变更", 409);
      const draft = await buildDraftData(tx, normalizeDraftInput(body), current.id, {
        allowPlannedDateAfterDelivery: true,
        allowContractProductChange: true,
      });
      const proposedDiff = toPlainJson({
        before: { contractId: current.contractId, contractItemId: current.contractItemId, productId: current.productId, quantity: current.quantity, bomId: current.bomId, specialRequirements: (current.configuration as any)?.specialRequirements || "", warehouseId: current.warehouseId, plannedDate: current.plannedDate, responsibleId: current.responsibleId, remark: current.remark },
        after: { contractId: draft.contractId, contractItemId: draft.contractItemId, productId: draft.productId, quantity: draft.quantity, bomId: draft.bomId, specialRequirements: (draft.configuration as any)?.specialRequirements || "", warehouseId: draft.warehouseId, plannedDate: draft.plannedDate, responsibleId: draft.responsibleId, remark: draft.remark },
      }) as Prisma.InputJsonValue;
      const changed = await tx.productionOrder.updateMany({ where: { id, status: "ISSUED", isCurrent: true, deletedAt: null }, data: { status: "CHANGE_PENDING" } });
      if (changed.count !== 1) throw new ProductionOrderRequestError("生产工单已被其他操作更新，请刷新后重试", 409);
      const created = await tx.productionOrderChangeRequest.create({ data: { productionOrderId: id, requesterId: user.id, reason, proposedDiff } });
      await writeOperationLog(tx, { userId: user.id, action: "CREATE_PRODUCTION_ORDER_CHANGE_REQUEST", entityType: "ProductionOrder", entityId: id, beforeData: { status: "ISSUED" }, afterData: { status: "CHANGE_PENDING", changeRequestId: created.id, proposedDiff } });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(changeRequest, { status: 201 });
  } catch (error) {
    if (error instanceof ProductionOrderRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
