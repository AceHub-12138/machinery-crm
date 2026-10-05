import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessCustomer } from "@/lib/permissions";
import { canEditContract } from "@/lib/sales-items";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { id } = await params;
    const quote = await prisma.customerQuote.findFirst({
      where: { id },
      include: { customer: { select: { region: true, businessLine: true, province: true, city: true } } },
    });

    if (!quote) return NextResponse.json({ error: "报价不存在" }, { status: 404 });
    if (!canAccessCustomer(user, quote.customer)) {
      return NextResponse.json({ error: "无权查看该报价" }, { status: 403 });
    }

    const contract = await prisma.contract.findFirst({
      where: { sourceQuoteId: id, deletedAt: null },
      include: { shipments: { select: { shipmentStatus: true } } },
    });
    const canEdit = contract ? canEditContract(user, contract) : false;

    return NextResponse.json({
      contract,
      locked: contract ? !canEdit : false,
      canEdit,
    });
  } catch (error) {
    console.error("[customer-quotes.contract.GET]", error);
    return NextResponse.json({ error: "报价关联合同读取失败" }, { status: 500 });
  }
}
