import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { validateAfterSalesReceipt } from "@/lib/after-sales";
import { accessibleAfterSalesWhere, afterSalesOrderInclude, assertAfterSalesAccess, dateOnly, stringList } from "@/lib/after-sales-service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    assertAfterSalesAccess(user);
    const { id } = await params;
    const current = await prisma.afterSalesOrder.findFirst({ where: accessibleAfterSalesWhere(user, id), include: { parts: { orderBy: { sortOrder: "asc" } } } });
    if (!current) return NextResponse.json({ error: "售后工单不存在或无权访问" }, { status: 404 });
    if (current.status !== "IN_PROGRESS") return NextResponse.json({ error: "仅处理中工单可提交回执" }, { status: 409 });
    const body = await request.json() as Record<string, unknown>;
    const receipt = validateAfterSalesReceipt(body);
    const partNames = body.partNames === undefined ? current.parts.map((part) => part.partName) : stringList(body.partNames, "配件");
    const completedDate = dateOnly(receipt.completedDate, "完成时间")!;
    const receiptAt = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.afterSalesOrder.update({
        where: { id: current.id },
        data: {
          completedDate,
          receiptContent: receipt.receiptContent,
          problemCategory: receipt.problemCategory,
          otherReason: receipt.otherReason,
          satisfaction: receipt.satisfaction,
          receiptAt,
          status: "COMPLETED",
          ...(body.partNames === undefined ? {} : { parts: { deleteMany: {}, create: partNames.map((partName, sortOrder) => ({ partName, sortOrder })) } }),
        },
        include: afterSalesOrderInclude,
      });
      await writeOperationLog(tx, { userId: user.id, action: "SUBMIT_AFTER_SALES_RECEIPT", entityType: "AfterSalesOrder", entityId: row.id, beforeData: current, afterData: row });
      return row;
    });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "提交售后回执失败" }, { status: 400 });
  }
}
