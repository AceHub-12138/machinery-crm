import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessERP, canManageMaterialMaster } from "@/lib/permissions";

async function validateSupplierId(supplierId: unknown) {
  if (!supplierId) return null;
  const supplier = await prisma.supplier.findFirst({
    where: { id: String(supplierId), isActive: true, deletedAt: null },
    select: { id: true },
  });
  return supplier ? supplier.id : undefined;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canAccessERP(user)) {
    return NextResponse.json({ error: "无权限访问 ERP" }, { status: 403 });
  }

  const { id } = await params;

  const material = await prisma.material.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true, code: true } },
    },
  });

  if (!material) {
    return NextResponse.json({ error: "物料不存在" }, { status: 404 });
  }

  return NextResponse.json(material);
}

/** 编码唯一冲突时给出可读提示；冲突方可能是软删除物料（列表不可见但仍占编码）。 */
async function duplicateCodeResponse(code: unknown) {
  const owner = typeof code === "string" && code
    ? await prisma.material.findFirst({ where: { code }, select: { name: true, deletedAt: true } })
    : null;
  const ownerDesc = owner ? `（已被「${owner.name}」使用${owner.deletedAt ? "，该物料已删除" : ""}）` : "";
  return NextResponse.json({ error: `物料编码 ${String(code ?? "")} 已被占用${ownerDesc}，请更换编码` }, { status: 409 });
}

/** 已删除物料让位用的墓碑编码：原编码后缀 #DEL+时间戳，保证唯一且可追溯。 */
async function nextTombstoneCode(tx: Prisma.TransactionClient, originalCode: string) {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const base = `${originalCode}#DEL-${stamp}`;
  let candidate = base;
  let seq = 2;
  while (await tx.material.findUnique({ where: { code: candidate }, select: { id: true } })) {
    candidate = `${base}-${seq}`;
    seq += 1;
  }
  return candidate;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canManageMaterialMaster(user)) {
    return NextResponse.json({ error: "无权限编辑物料" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  const supplierId = body.supplierId !== undefined ? await validateSupplierId(body.supplierId) : undefined;
  if (body.supplierId && !supplierId) {
    return NextResponse.json({ error: "供应商不存在或已停用" }, { status: 400 });
  }

  // 改码前的占用检查：目标编码被在用物料占用才算真冲突；
  // 被已删除物料占用时由该记录改名让位（墓碑编码），不再拦截。
  const targetCode = typeof body.code === "string" ? body.code.trim() : "";
  let tombstoneTargetId: string | null = null;
  if (targetCode) {
    const holder = await prisma.material.findFirst({
      where: { code: targetCode, id: { not: id } },
      select: { id: true, deletedAt: true },
    });
    if (holder && !holder.deletedAt) {
      return duplicateCodeResponse(targetCode);
    }
    if (holder) {
      tombstoneTargetId = holder.id;
    }
  }

  const buildUpdate = (tx: Prisma.TransactionClient) =>
    tx.material.update({
      where: { id },
      data: {
        code: body.code,
        name: body.name,
        categoryId: body.categoryId,
        spec: body.spec !== undefined ? (body.spec || null) : undefined,
        materialType: body.materialType !== undefined ? (body.materialType || null) : undefined,
        drawingNo: body.drawingNo !== undefined ? (body.drawingNo || null) : undefined,
        supplier: body.supplier !== undefined ? (body.supplier || null) : undefined,
        supplierId: supplierId === undefined ? undefined : supplierId || null,
        unit: body.unit || undefined,
        standardPrice: body.standardPrice !== undefined ? (body.standardPrice ? parseFloat(body.standardPrice) : null) : undefined,
        safetyStock: body.safetyStock !== undefined ? (body.safetyStock ? parseFloat(body.safetyStock) : null) : undefined,
        minStock: body.minStock !== undefined ? (body.minStock ? parseFloat(body.minStock) : null) : undefined,
        maxStock: body.maxStock !== undefined ? (body.maxStock ? parseFloat(body.maxStock) : null) : undefined,
        procurementLeadDays: body.procurementLeadDays !== undefined ? Math.max(0, Math.trunc(Number(body.procurementLeadDays || 0))) : undefined,
        safetyStockEnabled: body.safetyStockEnabled !== undefined ? body.safetyStockEnabled === true : undefined,
        autoPurchaseDraftEnabled: body.autoPurchaseDraftEnabled !== undefined ? body.autoPurchaseDraftEnabled === true : undefined,
        weight: body.weight !== undefined ? (body.weight ? parseFloat(body.weight) : null) : undefined,
        remark: body.remark !== undefined ? (body.remark || null) : undefined,
        isActive: body.isActive !== undefined ? body.isActive : undefined,
      },
      include: {
        category: { select: { id: true, name: true, code: true } },
      },
    });

  let material;
  let releasedTombCode = "";
  try {
    if (tombstoneTargetId) {
      material = await prisma.$transaction(async (tx) => {
        releasedTombCode = await nextTombstoneCode(tx, targetCode);
        await tx.material.update({
          where: { id: tombstoneTargetId },
          data: { code: releasedTombCode },
        });
        return buildUpdate(tx);
      });
    } else {
      material = await buildUpdate(prisma);
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return duplicateCodeResponse(body.code);
    }
    throw error;
  }

  if (releasedTombCode) {
    return NextResponse.json({
      ...material,
      releasedFrom: targetCode,
      releasedTombCode,
    });
  }
  return NextResponse.json(material);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canManageMaterialMaster(user)) {
    return NextResponse.json({ error: "无权限删除物料" }, { status: 403 });
  }

  const { id } = await params;

  // 软删除
  await prisma.material.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ success: true });
}
