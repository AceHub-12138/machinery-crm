import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { buildDraftData } from "@/lib/production-orders";
import { writeOperationLog } from "@/lib/sales-items";
import { monthlyDemandAllocation } from "@/lib/monthly-production-plans";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isSuperAdmin(user)) return NextResponse.json({ error: "仅管理员可转换生产工单" }, { status: 403 });
  const { id } = await params;
  const body = await request.json();
  const orderNo = String(body.orderNo || "").trim();
  if (!orderNo) return NextResponse.json({ error: "工单编号为必填项" }, { status: 400 });
  let quantity: Prisma.Decimal;
  try { quantity = new Prisma.Decimal(String(body.quantity)); } catch { return NextResponse.json({ error: "转换数量无效" }, { status: 400 }); }
  if (!quantity.gt(0)) return NextResponse.json({ error: "转换数量必须大于 0" }, { status: 400 });
  const requestKey = String(body.requestKey || "").trim();
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(requestKey)) return NextResponse.json({ error: "缺少有效幂等标识" }, { status: 400 });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const replay = await tx.productionOrder.findUnique({ where: { sourceRequestKey: requestKey } });
      if (replay) return replay;
      await tx.$queryRaw`SELECT id FROM erp_monthly_production_plan_items WHERE id = ${String(body.planItemId)} FOR UPDATE`;
      const item = await tx.monthlyProductionPlanItem.findFirst({ where: { id: String(body.planItemId), planId: id }, include: { plan: true, materialRequirements: true } });
      if (!item || !["APPROVED", "IN_PROGRESS"].includes(item.plan.status)) throw new Error("计划明细不存在或尚未审核");
      const remaining = new Prisma.Decimal(item.plannedQuantity).sub(item.convertedQuantity);
      if (quantity.gt(remaining)) throw new Error(`转换数量超过剩余数量 ${remaining.toString()}`);
      const data = await buildDraftData(tx, {
        orderNo, contractId: null, contractItemId: null, productId: item.productId, quantity, bomId: item.bomId,
        configuration: { monthlyPlanId: id, monthlyPlanItemId: item.id }, warehouseId: String(body.warehouseId || "") || null,
        plannedDate: item.plannedCompletionDate, responsibleId: String(body.responsibleId || "") || null, remark: String(body.remark || `来源月度计划 ${item.plan.planNo}`),
      });
      const created = await tx.productionOrder.create({ data: { ...data, sourceRequestKey: requestKey, monthlyPlanItemId: item.id, createdById: user.id } });
      const ratio = quantity.div(item.plannedQuantity);
      const demands = await tx.purchaseDemand.findMany({ where: { sourceType: "MONTHLY_PRODUCTION_PLAN", sourceRecordId: item.id, status: { not: "CANCELLED" } }, include: { allocations: true } });
      for (const demand of demands) {
        // Allocate the already planned purchase shortage proportionally. Using requestedQuantity
        // here could allocate the same shortage more than once when suggestion < gross demand.
        const allocatedQuantity = monthlyDemandAllocation(demand.suggestedQuantity, quantity, item.plannedQuantity);
        if (allocatedQuantity.gt(0)) await tx.purchaseDemandProductionAllocation.create({ data: { purchaseDemandId: demand.id, productionOrderId: created.id, purchaseOrderItemId: demand.allocations[0]?.purchaseOrderItemId || null, allocatedQuantity } });
      }
      await tx.monthlyProductionPlanItem.update({ where: { id: item.id }, data: { convertedQuantity: { increment: quantity } } });
      for (const req of item.materialRequirements) await tx.monthlyMaterialRequirement.update({ where: { id: req.id }, data: { convertedDemandQty: { increment: new Prisma.Decimal(req.requiredQuantity).mul(ratio).toDecimalPlaces(4) } } });
      await tx.monthlyProductionPlan.update({ where: { id }, data: { status: "IN_PROGRESS" } });
      await writeOperationLog(tx,{userId:user.id,action:"CONVERT_MONTHLY_PLAN_TO_ORDER",entityType:"MonthlyProductionPlan",entityId:id,afterData:{productionOrderId:created.id,planItemId:item.id,quantity}});
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "转换失败" }, { status: 409 }); }
}
