import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canPublishProductionOrder, getSessionUser } from "@/lib/permissions";
import { createKitCheckResult, expandBomSnapshot, nextSequenceInContract, ProductionOrderRequestError, validateProductionOrderForIssue } from "@/lib/production-orders";
import { writeOperationLog } from "@/lib/sales-items";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canPublishProductionOrder(user)) return NextResponse.json({ error: "无权限发布生产工单" }, { status: 403 });
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求数据格式错误" }, { status: 400 });
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.productionOrder.findFirst({ where: { id, deletedAt: null } });
        if (!existing) throw new ProductionOrderRequestError("生产工单不存在", 404);
        if (existing.status !== "DRAFT") throw new ProductionOrderRequestError("该工单不是草稿或已经发布，请勿重复发布", 409);
        if (existing.isStockOrder && body.confirmStockOrder !== true) throw new ProductionOrderRequestError("备货工单下达前必须明确确认", 400);
        await validateProductionOrderForIssue(tx, existing);
        const snapshot = await expandBomSnapshot(tx, { bomId: existing.bomId, productId: existing.productId, quantity: new Prisma.Decimal(existing.quantity) });
        const sequence = existing.contractId ? await nextSequenceInContract(tx, existing.contractId) : null;
        // 手工编号在创建草稿时已唯一校验；下达只冻结快照和状态，绝不覆盖用户输入。
        const updated = await tx.productionOrder.updateMany({ where: { id, status: "DRAFT", deletedAt: null }, data: { sequenceInContract: sequence, bomVersionSnapshot: snapshot.bomVersion, status: "ISSUED" } });
        if (updated.count !== 1) throw new ProductionOrderRequestError("生产工单已被其他操作更新，请刷新后重试", 409);
        await tx.productionOrderMaterial.createMany({ data: snapshot.materials.map((item) => ({ ...item, productionOrderId: id })) });
        await createKitCheckResult(tx, { productionOrderId: id, checkedById: user.id, triggerKey: `ISSUE:${id}`, triggerType: "ORDER_ISSUE" });
        const after = await tx.productionOrder.findUniqueOrThrow({ where: { id } });
        await writeOperationLog(tx, { userId: user.id, action: "ISSUE_PRODUCTION_ORDER", entityType: "ProductionOrder", entityId: id, beforeData: existing, afterData: after });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      const { getProductionOrderDetail } = await import("@/lib/production-orders");
      return NextResponse.json(await getProductionOrderDetail(id));
    } catch (error: any) {
      if ((error?.code === "P2002" || error?.code === "P2034") && attempt < 2) continue;
      if (error instanceof ProductionOrderRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
      throw error;
    }
  }
  return NextResponse.json({ error: "下达生产工单时发生并发冲突，请重试" }, { status: 409 });
}
