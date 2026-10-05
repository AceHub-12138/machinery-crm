import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, canManageProducts } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") || "";
  const productType = searchParams.get("productType") || "";

  const where: any = { isActive: true };
  if (category) {
    where.category = category;
  }
  if (productType) {
    where.productType = productType;
  }

  const products = await prisma.product.findMany({
    where,
    include: {
      translations: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(products);
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  if (!canManageProducts(user)) {
    return NextResponse.json({ error: "无权限管理产品" }, { status: 403 });
  }

  const body = await request.json();

  if (!body.model || !body.category) {
    return NextResponse.json({ error: "产品型号和分类为必填项" }, { status: 400 });
  }

  const product = await prisma.product.create({
    data: {
      model: body.model,
      category: body.category,
      productType: body.productType || "MAIN",
      imageUrl: body.imageUrl || null,
      videoUrl: body.videoUrl || null,
      factoryPrice: body.factoryPrice ? parseFloat(body.factoryPrice) : null,
      currency: body.currency || "CNY",
      remark: body.remark || null,
      isActive: body.isActive !== false,
      translations: body.translations
        ? {
            create: body.translations.map((t: any) => ({
              language: t.language,
              name: t.name,
              description: t.description || null,
              specs: t.specs || null,
              pdfUrl: t.pdfUrl || null,
            })),
          }
        : undefined,
    },
    include: { translations: true },
  });

  return NextResponse.json(product, { status: 201 });
}
