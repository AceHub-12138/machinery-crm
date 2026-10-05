import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessCustomer } from "@/lib/permissions";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;

  const customer = await prisma.customer.findFirst({
    where: { id, deletedAt: null },
  });
  if (!customer) return NextResponse.json({ error: "客户不存在" }, { status: 404 });
  if (!canAccessCustomer(user, customer)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const contracts = await prisma.contract.findMany({
    where: { customerId: id, deletedAt: null },
    include: {
      salesUser: { select: { name: true } },
      payments: { orderBy: { paymentDate: "desc" }, take: 1 },
      shipments: { orderBy: { shipmentDate: "desc" } },
      items: { orderBy: { sortOrder: "asc" } },
      sourceQuote: { select: { id: true } },
    },
    orderBy: { signedDate: "desc" },
  });

  return NextResponse.json(contracts);
}
