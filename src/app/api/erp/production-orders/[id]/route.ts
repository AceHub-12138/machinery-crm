import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canAccessERP, canPublishProductionOrder, getSessionUser } from "@/lib/permissions";
import { buildDraftData, getProductionOrderDetail, getProductionOrderProcurementView, normalizeDraftInput, ProductionOrderRequestError } from "@/lib/production-orders";
import { writeOperationLog } from "@/lib/sales-items";

function errorResponse(error: unknown) {
  if (error instanceof ProductionOrderRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
  throw error;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canAccessERP(user)) return NextResponse.json({ error: "无权限访问 ERP" }, { status: 403 });
  const { id } = await params;
  const order = user.role === "PURCHASE" ? await getProductionOrderProcurementView(id) : await getProductionOrderDetail(id);
  return order ? NextResponse.json(order) : NextResponse.json({ error: "生产工单不存在" }, { status: 404 });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canPublishProductionOrder(user)) return NextResponse.json({ error: "无权限编辑生产工单" }, { status: 403 });
  const { id } = await params;
  let input;
  try {
    input = normalizeDraftInput(await request.json());
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求数据格式错误" }, { status: 400 });
    return errorResponse(error);
  }
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.productionOrder.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new ProductionOrderRequestError("生产工单不存在", 404);
      if (existing.status !== "DRAFT") throw new ProductionOrderRequestError("仅草稿生产工单可以编辑", 409);
      const draft = await buildDraftData(tx, input, id);
      const changed = await tx.productionOrder.updateMany({ where: { id, status: "DRAFT", deletedAt: null }, data: draft });
      if (changed.count !== 1) throw new ProductionOrderRequestError("生产工单已被其他操作更新，请刷新后重试", 409);
      const after = await tx.productionOrder.findUniqueOrThrow({ where: { id } });
      await writeOperationLog(tx, { userId: user.id, action: "UPDATE_PRODUCTION_ORDER", entityType: "ProductionOrder", entityId: id, beforeData: existing, afterData: after });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    return errorResponse(error);
  }
  return NextResponse.json(await getProductionOrderDetail(id));
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canPublishProductionOrder(user)) return NextResponse.json({ error: "无权限删除生产工单" }, { status: 403 });
  const { id } = await params;
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.productionOrder.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new ProductionOrderRequestError("生产工单不存在", 404);
      if (existing.status !== "DRAFT") throw new ProductionOrderRequestError("仅草稿生产工单可以删除", 409);
      const result = await tx.productionOrder.updateMany({ where: { id, status: "DRAFT", deletedAt: null }, data: { deletedAt: new Date(), isCurrent: false } });
      if (result.count !== 1) throw new ProductionOrderRequestError("生产工单已被其他操作更新，请刷新后重试", 409);
      await writeOperationLog(tx, { userId: user.id, action: "DELETE_PRODUCTION_ORDER", entityType: "ProductionOrder", entityId: id, beforeData: existing, afterData: { deletedAt: new Date() } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    return errorResponse(error);
  }
  return NextResponse.json({ success: true });
}
