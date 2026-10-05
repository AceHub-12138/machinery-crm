import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, canSeeAllData, customerIsolationWhere } from "@/lib/permissions";
import { assertAfterSalesAccess } from "@/lib/after-sales-service";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    assertAfterSalesAccess(user);
    const keyword = (request.nextUrl.searchParams.get("q") || "").trim();
    const rows = await prisma.contract.findMany({
      where: {
        deletedAt: null,
        customer: canSeeAllData(user) ? {} : customerIsolationWhere(user),
        ...(keyword ? { OR: [{ contractNo: { contains: keyword } }, { equipmentModel: { contains: keyword } }, { customer: { companyName: { contains: keyword } } }] } : {}),
      },
      select: { id: true, contractNo: true, equipmentName: true, equipmentModel: true, customer: { select: { id: true, companyName: true } }, salesUser: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return NextResponse.json({ items: rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "合同加载失败" }, { status: 400 });
  }
}
