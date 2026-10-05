import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, canManageProducts } from "@/lib/permissions";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: { translations: true },
  });

  if (!product) {
    return NextResponse.json({ error: "产品不存在" }, { status: 404 });
  }

  return NextResponse.json(product);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  if (!canManageProducts(user)) {
    return NextResponse.json({ error: "无权限编辑产品" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  const product = await prisma.product.update({
    where: { id },
    data: {
      model: body.model,
      category: body.category,
      productType: body.productType || undefined,
      imageUrl: body.imageUrl || null,
      videoUrl: body.videoUrl || null,
      factoryPrice: body.factoryPrice !== undefined ? (body.factoryPrice ? parseFloat(body.factoryPrice) : null) : undefined,
      currency: body.currency || undefined,
      remark: body.remark !== undefined ? (body.remark || null) : undefined,
      isActive: body.isActive !== false,
    },
  });

  // 更新翻译（先删后建策略）
  if (body.translations) {
    await prisma.productTranslation.deleteMany({ where: { productId: id } });
    await prisma.productTranslation.createMany({
      data: body.translations.map((t: any) => ({
        productId: id,
        language: t.language,
        name: t.name,
        description: t.description || null,
        specs: t.specs || null,
        pdfUrl: t.pdfUrl || null,
      })),
    });
  }

  const updated = await prisma.product.findUnique({
    where: { id },
    include: { translations: true },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  if (!canManageProducts(user)) {
    return NextResponse.json({ error: "无权限删除产品" }, { status: 403 });
  }

  const { id } = await params;

  await prisma.product.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
