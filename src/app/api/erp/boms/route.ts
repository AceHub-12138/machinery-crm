import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessERP, canManageBom } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { BomWriteItem, normalizeBomWriteItems } from "@/lib/bom-items";

async function loadProducts(productIds: string[]) {
  if (productIds.length === 0) return new Map<string, any>();
  const products = await prisma.product.findMany({
    where: { id: { in: [...new Set(productIds)] } },
    include: { translations: { where: { language: "ZH" }, take: 1 } },
  });
  return new Map(products.map((product) => [product.id, product]));
}

async function attachProducts<T extends { productId: string }>(boms: T[]) {
  const productMap = await loadProducts(boms.map((bom) => bom.productId));
  return boms.map((bom) => ({
    ...bom,
    product: productMap.get(bom.productId) || null,
  }));
}

async function createBomItems(
  tx: Prisma.TransactionClient,
  bomId: string,
  items: BomWriteItem[]
) {
  const idByClientKey = new Map<string, string>();
  for (const item of [...items].sort((a, b) => a.level - b.level || a.sortOrder - b.sortOrder)) {
    const parentItemId = item.parentClientKey ? idByClientKey.get(item.parentClientKey) || null : null;
    const created = await tx.bomItem.create({
      data: {
        bomId,
        materialId: item.materialId,
        quantity: item.quantity!,
        level: item.level,
        parentItemId,
        sortOrder: item.sortOrder,
      },
    });
    idByClientKey.set(item.clientKey, created.id);
  }
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canAccessERP(user)) {
    return NextResponse.json({ error: "无权限访问 ERP" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId") || "";
  const search = searchParams.get("search") || "";
  const active = searchParams.get("active") || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));
  const skip = (page - 1) * pageSize;

  const productWhere: any = search
    ? {
        OR: [
          { model: { contains: search } },
          { category: { contains: search } },
          { translations: { some: { name: { contains: search } } } },
        ],
      }
    : {};
  const matchedProducts = search
    ? await prisma.product.findMany({ where: productWhere, select: { id: true } })
    : [];

  const where: any = {};
  if (productId) where.productId = productId;
  if (active === "1") where.isActive = true;
  if (active === "0") where.isActive = false;
  if (search) where.OR = [
    { version: { contains: search } },
    { productId: { in: matchedProducts.map((product) => product.id) } },
  ];

  const [boms, total] = await Promise.all([
    prisma.bomHeader.findMany({
      where,
      include: {
        items: {
          include: {
            material: {
              select: { id: true, code: true, name: true, spec: true, unit: true, standardPrice: true },
            },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
      skip,
      take: pageSize,
    }),
    prisma.bomHeader.count({ where }),
  ]);

  return NextResponse.json({
    items: await attachProducts(boms),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canManageBom(user)) {
    return NextResponse.json({ error: "无权限维护整机用料清单" }, { status: 403 });
  }

  const body = await request.json();
  if (!body.productId) {
    return NextResponse.json({ error: "请选择产品" }, { status: 400 });
  }

  const product = await prisma.product.findFirst({
    where: { id: body.productId, isActive: true, productType: "MAIN" },
    select: { id: true },
  });
  if (!product) {
    return NextResponse.json({ error: "整机用料清单只能关联启用的主产品" }, { status: 404 });
  }

  const materialIds = Array.isArray(body.items) ? [...new Set(body.items.map((item: any) => String(item?.materialId || "")).filter(Boolean))] as string[] : [];
  const materials = await prisma.material.findMany({ where: { id: { in: materialIds }, isActive: true, deletedAt: null }, select: { id: true, unit: true, category: { select: { name: true } } } });
  let items: BomWriteItem[];
  try { items = normalizeBomWriteItems(body.items, new Map(materials.map((material) => [material.id, material.unit])), new Set(materials.filter((material) => material.category.name.includes("零件包")).map((material) => material.id))); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "用料清单明细无效" }, { status: 400 }); }

  const version = String(body.version || "v1.0").trim();
  const duplicated = await prisma.bomHeader.findFirst({
    where: { productId: body.productId, version },
    select: { id: true },
  });
  if (duplicated) {
    return NextResponse.json({ error: "同一产品已存在相同用料清单版本" }, { status: 409 });
  }

  const isActive = body.isActive !== false;
  const bom = await prisma.$transaction(async (tx) => {
    if (isActive) {
      await tx.bomHeader.updateMany({
        where: { productId: body.productId, isActive: true },
        data: { isActive: false },
      });
    }

    const created = await tx.bomHeader.create({
      data: {
        productId: body.productId,
        version,
        isActive,
        remark: body.remark || null,
      },
    });

    await createBomItems(tx, created.id, items);

    const after = await tx.bomHeader.findUnique({
      where: { id: created.id },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    await writeOperationLog(tx, {
      userId: user.id,
      action: "CREATE_BOM",
      entityType: "BomHeader",
      entityId: created.id,
      afterData: after,
    });

    return created;
  });

  const detail = await prisma.bomHeader.findUnique({
    where: { id: bom.id },
    include: {
      items: {
        include: {
          material: { select: { id: true, code: true, name: true, spec: true, unit: true, standardPrice: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  return NextResponse.json((await attachProducts(detail ? [detail] : []))[0] || bom, { status: 201 });
}
