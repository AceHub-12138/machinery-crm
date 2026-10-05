import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { buildDraftData, createKitCheckResult, expandBomSnapshot, normalizeDraftInput, ProductionOrderRequestError } from "@/lib/production-orders";
import { writeOperationLog } from "@/lib/sales-items";

type ProposedDiff = { after?: Record<string, unknown> };

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isSuperAdmin(user)) return NextResponse.json({ error: "仅超级管理员可以批准工单变更" }, { status: 403 });
  const { id } = await params;
  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { /* approval remark is optional */ }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const requestRecord = await tx.productionOrderChangeRequest.findUnique({ where: { id }, include: { productionOrder: true } });
      if (!requestRecord) throw new ProductionOrderRequestError("工单变更申请不存在", 404);
      if (requestRecord.status !== "PENDING") throw new ProductionOrderRequestError("该变更申请已经处理", 409);
      const current = requestRecord.productionOrder;
      if (current.status !== "CHANGE_PENDING" || !current.isCurrent || current.deletedAt) throw new ProductionOrderRequestError("当前工单状态不允许批准该变更申请", 409);
      const [issuedDocuments, returnedDocuments] = await Promise.all([
        tx.stockOut.findMany({ where: { productionOrderId: current.id }, include: { items: true } }),
        tx.stockIn.findMany({ where: { productionOrderId: current.id, status: "CONFIRMED" }, include: { items: true } }),
      ]);
      const netIssuedByMaterial = new Map<string, Prisma.Decimal>();
      for (const document of issuedDocuments) for (const item of document.items) netIssuedByMaterial.set(item.materialId, (netIssuedByMaterial.get(item.materialId) || new Prisma.Decimal(0)).add(item.quantity));
      for (const document of returnedDocuments) for (const item of document.items) netIssuedByMaterial.set(item.materialId, (netIssuedByMaterial.get(item.materialId) || new Prisma.Decimal(0)).sub(item.quantity));
      if ([...netIssuedByMaterial.values()].some((quantity) => quantity.gt(0))) {
        throw new ProductionOrderRequestError("工单仍有净领料；请先逐项退料使净领料归零后再批准变更，避免领料与新版本脱节", 409);
      }
      const proposed = requestRecord.proposedDiff as ProposedDiff;
      if (!proposed.after) throw new ProductionOrderRequestError("变更申请数据不完整", 400);
      const draft = await buildDraftData(tx, normalizeDraftInput(proposed.after), current.id, {
        allowPlannedDateAfterDelivery: true,
        allowContractProductChange: true,
      });
      const snapshot = await expandBomSnapshot(tx, { bomId: draft.bomId, productId: draft.productId, quantity: new Prisma.Decimal(draft.quantity) });
      const nextVersion = current.version + 1;
      const successor = await tx.productionOrder.create({
        data: { ...draft, orderNo: `${current.orderNo}-V${nextVersion}`, status: "ISSUED", version: nextVersion, supersedesId: current.id, isCurrent: true, sequenceInContract: current.sequenceInContract, createdById: user.id },
      });
      await tx.productionOrderMaterial.createMany({ data: snapshot.materials.map((item) => ({ ...item, productionOrderId: successor.id })) });
      const retired = await tx.productionOrder.updateMany({ where: { id: current.id, status: "CHANGE_PENDING", isCurrent: true }, data: { isCurrent: false } });
      if (retired.count !== 1) throw new ProductionOrderRequestError("当前工单已被其他操作更新，请刷新后重试", 409);
      const kitCheck = await createKitCheckResult(tx, { productionOrderId: successor.id, checkedById: user.id, triggerKey: `CHANGE:${id}:${nextVersion}`, triggerType: "ORDER_CHANGE" });
      const approved = await tx.productionOrderChangeRequest.update({ where: { id }, data: { status: "APPROVED", approverId: user.id, approvalRemark: String(body.remark || "").trim() || null, approvedAt: new Date() } });
      await writeOperationLog(tx, { userId: user.id, action: "APPROVE_PRODUCTION_ORDER_CHANGE_REQUEST", entityType: "ProductionOrder", entityId: successor.id, beforeData: { previousOrderId: current.id, version: current.version }, afterData: { changeRequestId: approved.id, version: successor.version, kitCheckId: kitCheck.id } });
      return { successor, kitCheck, approved };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProductionOrderRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
