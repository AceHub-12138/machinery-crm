import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/permissions";
import { assertAfterSalesAccess, findAccessibleContract } from "@/lib/after-sales-service";
import { mergeAfterSalesPartNames } from "@/lib/after-sales";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    assertAfterSalesAccess(user);
    const contractId = request.nextUrl.searchParams.get("contractId") || "";
    if (!contractId) return NextResponse.json({ error: "合同必选" }, { status: 400 });
    const contract = await findAccessibleContract(user, contractId);
    if (!contract) return NextResponse.json({ error: "合同不存在或无权访问" }, { status: 404 });
    const [bom, supplements] = await Promise.all([
      contract.productId ? prisma.bomHeader.findFirst({
        where: { productId: contract.productId, isActive: true },
        orderBy: { updatedAt: "desc" },
        select: { items: { where: { material: { isActive: true, deletedAt: null } }, select: { material: { select: { name: true } } } } },
      }) : Promise.resolve(null),
      prisma.afterSalesSupplementPart.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    ]);
    const bomNames = bom?.items.map((item) => item.material.name) || [];
    return NextResponse.json({ items: mergeAfterSalesPartNames(bomNames, supplements.map((item) => item.name)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "售后配件加载失败" }, { status: 400 });
  }
}
