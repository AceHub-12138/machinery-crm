import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessERP } from "@/lib/permissions";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canAccessERP(user)) {
    return NextResponse.json({ error: "无权限访问 ERP" }, { status: 403 });
  }

  const { id } = await params;

  const stockIn = await prisma.stockIn.findUnique({
    where: { id },
    include: {
      warehouse: { select: { id: true, name: true, code: true } },
      items: {
        include: {
          material: { select: { id: true, name: true, code: true, spec: true, unit: true, standardPrice: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
      voidRecord: {
        include: {
          items: {
            include: { material: { select: { id: true, code: true, name: true, spec: true, unit: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (!stockIn) {
    return NextResponse.json({ error: "入库单不存在" }, { status: 404 });
  }

  const [purchaseOrder, voidedBy, stockMovements, operationLogs] = await Promise.all([
    stockIn.purchaseOrderId
      ? prisma.purchaseOrder.findFirst({
        where: { id: stockIn.purchaseOrderId, deletedAt: null },
        select: { id: true, orderNo: true, status: true },
      })
      : null,
    stockIn.voidedById
      ? prisma.user.findUnique({ where: { id: stockIn.voidedById }, select: { id: true, name: true } })
      : null,
    prisma.stockMovement.findMany({
      where: stockIn.voidRecord
        ? { OR: [{ refType: "StockIn", refId: stockIn.id }, { refType: "StockInVoid", refId: stockIn.voidRecord.id }] }
        : { refType: "StockIn", refId: stockIn.id },
      include: { material: { select: { id: true, code: true, name: true, spec: true, unit: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.operationLog.findMany({
      where: { entityType: "StockIn", entityId: stockIn.id },
      select: { id: true, action: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);
  return NextResponse.json({ ...stockIn, purchaseOrder, voidedBy, stockMovements, operationLogs });
}
