import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessCustomer } from "@/lib/permissions";

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
      include: {
        customer: { select: { id: true, companyName: true, contactName: true, phone: true, region: true, businessLine: true, province: true, city: true } },
        product: { include: { translations: { where: { language: "ZH" } } } },
        items: {
          orderBy: { sortOrder: "asc" },
          include: { product: { include: { translations: { where: { language: "ZH" } } } } },
        },
        sourceContract: { select: { id: true, contractNo: true, contractStatus: true, amount: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    if (!quote) return NextResponse.json({ error: "报价不存在" }, { status: 404 });
    if (!canAccessCustomer(user, quote.customer)) {
      return NextResponse.json({ error: "无权查看该报价" }, { status: 403 });
    }

    return NextResponse.json(quote);
  } catch (error) {
    console.error("[customer-quotes.id.GET]", error);
    return NextResponse.json({ error: "报价详情加载失败" }, { status: 500 });
  }
}
