import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { flattenBomLeafRequirements } from "@/lib/bom-items";
import { writeOperationLog } from "@/lib/sales-items";

export function monthlyDemandAllocation(suggestedQuantity: Prisma.Decimal.Value, convertedQuantity: Prisma.Decimal.Value, plannedQuantity: Prisma.Decimal.Value) {
  const planned = new Prisma.Decimal(plannedQuantity);
  if (planned.lte(0)) throw new Error("月度计划数量必须大于 0");
  return new Prisma.Decimal(suggestedQuantity).mul(convertedQuantity).div(planned).toDecimalPlaces(4);
}

export function parsePlanMonth(value: unknown) {
  const text = String(value || "").trim();
  const match = /^(\d{4})-(0[1-9]|1[0-2])(?:-01)?$/.exec(text);
  if (!match) throw new Error("计划月份格式无效");
  return new Date(`${match[1]}-${match[2]}-01T00:00:00.000Z`);
}

export async function approveMonthlyProductionPlan(tx: Prisma.TransactionClient, input: { planId: string; approvedById: string }) {
  const plan = await tx.monthlyProductionPlan.findFirst({
    where: { id: input.planId, status: "PENDING_APPROVAL" },
    include: { items: true },
  });
  if (!plan) throw new Error("月度计划不存在或当前状态不能审核");
  for (const planItem of plan.items) {
    const bom = await tx.bomHeader.findFirst({
      where: { id: planItem.bomId, productId: planItem.productId, isActive: true },
      include: { items: { include: { material: true }, orderBy: { sortOrder: "asc" } } },
    });
    if (!bom || bom.version !== planItem.bomVersionSnapshot) throw new Error(`${planItem.productModelSnapshot} 的 BOM 版本已变化，请创建计划新版本`);
    const leaves = flattenBomLeafRequirements(bom.items, planItem.plannedQuantity);
    const byMaterial = new Map(leaves.map((leaf) => [leaf.materialId, leaf]));
    for (const leaf of byMaterial.values()) {
      await tx.monthlyMaterialRequirement.upsert({
        where: { planItemId_materialId: { planItemId: planItem.id, materialId: leaf.materialId } },
        create: {
          planItemId: planItem.id,
          materialId: leaf.materialId,
          requiredQuantity: leaf.requiredQuantity,
          plannedDemandQty: leaf.requiredQuantity,
          calculationSnapshot: { procurementDemandCreated: false, purpose: "PRODUCTION_PLAN_SNAPSHOT" },
        },
        update: {
          requiredQuantity: leaf.requiredQuantity,
          plannedDemandQty: leaf.requiredQuantity,
          calculationSnapshot: { procurementDemandCreated: false, purpose: "PRODUCTION_PLAN_SNAPSHOT" },
        },
      });
    }
  }
  const approved=await tx.monthlyProductionPlan.update({ where: { id: plan.id }, data: { status: "APPROVED", approvedById: input.approvedById, approvedAt: new Date() }, include: { items: { include: { materialRequirements: true } } } });
  await writeOperationLog(tx,{userId:input.approvedById,action:"APPROVE_MONTHLY_PRODUCTION_PLAN",entityType:"MonthlyProductionPlan",entityId:plan.id,beforeData:{status:plan.status},afterData:{status:approved.status,version:approved.version}});return approved;
}

export function monthlyPlanNo(month: Date, version: number) {
  return `MP-${month.toISOString().slice(0, 7).replace("-", "")}-V${version}-${randomUUID().slice(0, 4).toUpperCase()}`;
}
