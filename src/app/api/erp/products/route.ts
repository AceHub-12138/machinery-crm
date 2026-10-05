import { NextRequest, NextResponse } from "next/server";
import { ProductType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessERP } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canAccessERP(user)) {
    return NextResponse.json({ error: "无权限访问 ERP" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const productType = searchParams.get("productType") || "";
  const search = searchParams.get("search")?.trim() || "";
  const pageSize = Math.min(50, Math.max(1, Number(searchParams.get("pageSize") || 50)));
  const typeFilter = productType === "MAIN" || productType === "OPTIONAL"
    ? (productType as ProductType)
    : undefined;

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      ...(typeFilter ? { productType: typeFilter } : {}),
      ...(search ? { OR: [{ model: { contains: search } }, { translations: { some: { name: { contains: search } } } }] } : {}),
    },
    include: {
      translations: { where: { language: "ZH" }, take: 1 },
    },
    orderBy: { model: "asc" },
    take: pageSize,
  });

  return NextResponse.json(products);
}
