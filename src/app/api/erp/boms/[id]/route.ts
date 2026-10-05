import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, canManageBom } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { BomWriteItem, normalizeBomWriteItems } from "@/lib/bom-items";

async function loadProduct(productId: string) {
  return prisma.product.findUnique({
    where: { id: productId },
    include: { translations: { where: { language: "ZH" }, take: 1 } },
  });
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

async function loadBom(id: string) {
  const bom = await prisma.bomHeader.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          material: {
            select: {
              id: true,
              code: true,
              name: true,
              spec: true,
              unit: true,
              standardPrice: true,
              supplier: true,
              category: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!bom) return null;
  return {
    ...bom,
    product: await loadProduct(bom.productId),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canManageBom(user)) {
    return NextResponse.json({ error: "无权限访问 ERP" }, { status: 403 });
  }

  const { id } = await params;
  const bom = await loadBom(id);
  if (!bom) {
    return NextResponse.json({ error: "整机用料清单不存在" }, { status: 404 });
  }

  return NextResponse.json(bom);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canManageBom(user)) {
    return NextResponse.json({ error: "无权限维护整机用料清单" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  const existing = await prisma.bomHeader.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "整机用料清单不存在" }, { status: 404 });
  }

  const nextProductId = body.productId || existing.productId;
  const product = await prisma.product.findFirst({
    where: { id: nextProductId, isActive: true, productType: "MAIN" },
    select: { id: true },
  });
  if (!product) {
    return NextResponse.json({ error: "整机用料清单只能关联启用的主产品" }, { status: 404 });
  }

  const nextVersion = String(body.version || existing.version || "v1.0").trim();
  const duplicated = await prisma.bomHeader.findFirst({
    where: { productId: nextProductId, version: nextVersion, id: { not: id } },
    select: { id: true },
  });
  if (duplicated) {
    return NextResponse.json({ error: "同一产品已存在相同用料清单版本" }, { status: 409 });
  }

  const materialIds = Array.isArray(body.items) ? [...new Set(body.items.map((item: any) => String(item?.materialId || "")).filter(Boolean))] as string[] : [];
  const materials = await prisma.material.findMany({ where: { id: { in: materialIds }, isActive: true, deletedAt: null }, select: { id: true, unit: true, category: { select: { name: true } } } });
  let items: BomWriteItem[];
  try { items = normalizeBomWriteItems(body.items, new Map(materials.map((material) => [material.id, material.unit])), new Set(materials.filter((material) => material.category.name.includes("零件包")).map((material) => material.id))); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "用料清单明细无效" }, { status: 400 }); }

  const isActive = body.isActive !== false;
  const targetId = await prisma.$transaction(async (tx) => {
    const hasFrozenUsage = await tx.productionOrder.count({ where: { bomId: id, deletedAt: null } }) > 0;
    if (isActive) {
      await tx.bomHeader.updateMany({
        where: { productId: nextProductId, isActive: true, id: { not: id } },
        data: { isActive: false },
      });
    }

    const updated = hasFrozenUsage
      ? await tx.bomHeader.create({ data: { productId: nextProductId, version: nextVersion, isActive, remark: body.remark || null, supersedesId: id } })
      : await tx.bomHeader.update({ where: { id }, data: { productId: nextProductId, version: nextVersion, isActive, remark: body.remark || null } });
    if (hasFrozenUsage) await tx.bomHeader.update({ where: { id }, data: { isActive: false } });
    else await tx.bomItem.deleteMany({ where: { bomId: id } });

    await createBomItems(tx, updated.id, items);
    const after = await tx.bomHeader.findUnique({
      where: { id: updated.id },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    await writeOperationLog(tx, {
      userId: user.id,
      action: "UPDATE_BOM",
      entityType: "BomHeader",
      entityId: updated.id,
      beforeData: existing,
      afterData: after,
    });
    return updated.id;
  });

  return NextResponse.json(await loadBom(targetId));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canManageBom(user)) {
    return NextResponse.json({ error: "无权限停用整机用料清单" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.bomHeader.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "整机用料清单不存在" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    const after = await tx.bomHeader.update({
      where: { id },
      data: { isActive: false },
    });
    await writeOperationLog(tx, {
      userId: user.id,
      action: "DISABLE_BOM",
      entityType: "BomHeader",
      entityId: id,
      beforeData: existing,
      afterData: after,
    });
  });

  return NextResponse.json({ success: true });
}
