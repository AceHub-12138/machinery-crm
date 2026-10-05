import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import {
  accessibleAfterSalesWhere,
  afterSalesOrderInclude,
  afterSalesOrderPayload,
  assertAfterSalesAccess,
} from "@/lib/after-sales-service";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    assertAfterSalesAccess(user);
    const { id } = await params;
    const item = await prisma.afterSalesOrder.findFirst({ where: accessibleAfterSalesWhere(user, id), include: afterSalesOrderInclude });
    if (!item) return NextResponse.json({ error: "售后工单不存在或无权访问" }, { status: 404 });
    return NextResponse.json(item);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "售后工单加载失败" }, { status: 400 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    assertAfterSalesAccess(user);
    const { id } = await params;
    const current = await prisma.afterSalesOrder.findFirst({ where: accessibleAfterSalesWhere(user, id), include: { parts: { orderBy: { sortOrder: "asc" } } } });
    if (!current) return NextResponse.json({ error: "售后工单不存在或无权访问" }, { status: 404 });
    if (!["PENDING_DISPATCH", "DISPATCHED"].includes(current.status)) return NextResponse.json({ error: "仅待派发或已派发工单可编辑" }, { status: 409 });
    const body = await request.json() as Record<string, unknown>;
    const payload = afterSalesOrderPayload({
      orderType: body.orderType ?? current.orderType,
      urgency: body.urgency ?? current.urgency,
      dispatchDate: body.dispatchDate ?? current.dispatchDate.toISOString(),
      serviceAmount: body.serviceAmount ?? current.serviceAmount?.toString() ?? null,
      assigneeNames: body.assigneeNames ?? current.assigneeNames,
      serviceAddress: body.serviceAddress === undefined ? current.serviceAddress : body.serviceAddress,
      description: body.description ?? current.description,
      partNames: body.partNames ?? current.parts.map((part) => part.partName),
    });
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.afterSalesOrder.update({
        where: { id: current.id },
        data: {
          orderType: payload.orderType,
          urgency: payload.urgency,
          dispatchDate: payload.dispatchDate,
          serviceAmount: payload.serviceAmount,
          assigneeNames: payload.assigneeNames,
          serviceAddress: payload.serviceAddress,
          description: payload.description,
          parts: { deleteMany: {}, create: payload.partNames.map((partName, sortOrder) => ({ partName, sortOrder })) },
        },
        include: afterSalesOrderInclude,
      });
      await writeOperationLog(tx, { userId: user.id, action: "UPDATE_AFTER_SALES_ORDER", entityType: "AfterSalesOrder", entityId: row.id, beforeData: current, afterData: row });
      return row;
    });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新售后工单失败" }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isSuperAdmin(user)) return NextResponse.json({ error: "仅超级管理员可删除售后工单" }, { status: 403 });
  const { id } = await params;
  const current = await prisma.afterSalesOrder.findFirst({ where: { id, deletedAt: null } });
  if (!current) return NextResponse.json({ error: "售后工单不存在" }, { status: 404 });
  const deletedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const row = await tx.afterSalesOrder.update({ where: { id }, data: { deletedAt } });
    await writeOperationLog(tx, { userId: user.id, action: "DELETE_AFTER_SALES_ORDER", entityType: "AfterSalesOrder", entityId: id, beforeData: current, afterData: { id: row.id, deletedAt } });
  });
  return NextResponse.json({ id, deletedAt });
}
