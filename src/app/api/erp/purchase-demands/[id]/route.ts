import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, canManagePurchaseDemands, isSuperAdmin } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { upsertPurchaseDemandForSource } from "@/lib/procurement-planning";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canManagePurchaseDemands(user)) return NextResponse.json({ error: "无权限" }, { status: 403 });
  const { id } = await params;
  const body = await request.json();
  const current = await prisma.purchaseDemand.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "采购需求不存在" }, { status: 404 });
  if (body.action === "CANCEL") {
    if (!isSuperAdmin(user)) return NextResponse.json({ error: "仅管理员可关闭采购需求" }, { status: 403 });
    if (current.convertedQuantity.gt(0)) return NextResponse.json({ error: "已转换数量不能静默取消，请先处理关联采购订单" }, { status: 409 });
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.purchaseDemand.update({ where: { id }, data: { status: "CANCELLED", activeSlot: null, cancelledAt: new Date() } });
      const replacement = ["PRODUCTION_ORDER", "MONTHLY_PRODUCTION_PLAN"].includes(current.sourceType)
        ? await upsertPurchaseDemandForSource(tx, {
          sourceType: current.sourceType, sourceRecordId: current.sourceRecordId, sourceLineId: current.sourceLineId,
          sourceLabel: current.sourceLabel, materialId: current.materialId, newDemand: current.requestedQuantity,
          needByDate: current.needByDate, createdById: user.id, stockPurpose: current.stockPurpose,
          replenishmentReason: current.replenishmentReason, targetStockQuantity: current.targetStockQuantity,
          excludeProductionOrderId: current.sourceType === "PRODUCTION_ORDER" ? current.sourceRecordId : undefined,
        }) : null;
      await writeOperationLog(tx, { userId: user.id, action: "CANCEL_PURCHASE_DEMAND", entityType: "PurchaseDemand", entityId: id, beforeData: current, afterData: { cancelled: row, recalculatedDemandId: replacement?.id || null } });
      return { cancelled: row, replacement };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(updated);
  }
  if (body.action === "APPROVE") {
    if (!isSuperAdmin(user)) return NextResponse.json({ error: "仅管理员可审核" }, { status: 403 });
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.purchaseDemand.update({ where: { id }, data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() } });
      await writeOperationLog(tx, { userId: user.id, action: "APPROVE_PURCHASE_DEMAND", entityType: "PurchaseDemand", entityId: id, beforeData: current, afterData: row });
      return row;
    });
    return NextResponse.json(updated);
  }
  return NextResponse.json({ error: "操作无效" }, { status: 400 });
}
