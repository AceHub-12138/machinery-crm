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

  const stockOut = await prisma.stockOut.findUnique({
    where: { id },
    include: {
      warehouse: { select: { id: true, name: true, code: true } },
      items: {
        include: {
          material: { select: { id: true, name: true, code: true, spec: true, unit: true, standardPrice: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!stockOut) {
    return NextResponse.json({ error: "出库单不存在" }, { status: 404 });
  }

  return NextResponse.json(stockOut);
}
