import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { canTransitionAfterSalesStatus } from "@/lib/after-sales";
import { accessibleAfterSalesWhere, afterSalesOrderInclude, assertAfterSalesAccess, assertStatus } from "@/lib/after-sales-service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    assertAfterSalesAccess(user);
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    const nextStatus = assertStatus(body.status);
    const current = await prisma.afterSalesOrder.findFirst({ where: accessibleAfterSalesWhere(user, id) });
    if (!current) return NextResponse.json({ error: "售后工单不存在或无权访问" }, { status: 404 });
    if (nextStatus === "COMPLETED") return NextResponse.json({ error: "请通过回执提交完成工单" }, { status: 409 });
    const attachmentCount = nextStatus === "CLOSED"
      ? await prisma.erpAttachment.count({ where: { entityType: "AFTER_SALES_ORDER", entityId: id, deletedAt: null } })
      : 0;
    const currentStatus = assertStatus(current.status);
    if (!canTransitionAfterSalesStatus(currentStatus, nextStatus, attachmentCount > 0)) {
      const message = currentStatus === "COMPLETED" && nextStatus === "CLOSED"
        ? "上传客户签字附件后方可关闭工单"
        : "工单状态流转无效";
      return NextResponse.json({ error: message }, { status: 409 });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.afterSalesOrder.update({ where: { id }, data: { status: nextStatus, ...(nextStatus === "CLOSED" ? { closedAt: new Date() } : {}) }, include: afterSalesOrderInclude });
      await writeOperationLog(tx, { userId: user.id, action: "UPDATE_AFTER_SALES_STATUS", entityType: "AfterSalesOrder", entityId: id, beforeData: { status: current.status }, afterData: { status: row.status, closedAt: row.closedAt } });
      return row;
    });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新工单状态失败" }, { status: 400 });
  }
}
