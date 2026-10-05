import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessERP, canManageMaterialMaster } from "@/lib/permissions";

/** 编码唯一冲突时给出可读提示；冲突方可能是软删除物料（列表不可见但仍占编码）。 */
async function duplicateCodeResponse(code: unknown) {
  const owner = typeof code === "string" && code
    ? await prisma.material.findFirst({ where: { code }, select: { name: true, deletedAt: true } })
    : null;
  const ownerDesc = owner ? `（已被「${owner.name}」使用${owner.deletedAt ? "，该物料已删除" : ""}）` : "";
  return NextResponse.json({ error: `物料编码 ${String(code ?? "")} 已被占用${ownerDesc}，请更换编码` }, { status: 409 });
}

async function validateSupplierId(supplierId: unknown) {
  if (!supplierId) return null;
  const supplier = await prisma.supplier.findFirst({
    where: { id: String(supplierId), isActive: true, deletedAt: null },
    select: { id: true },
  });
  return supplier ? supplier.id : undefined;
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
  const search = searchParams.get("search") || "";
  const categoryId = searchParams.get("categoryId") || "";
  const includeDeleted = searchParams.get("includeDeleted") === "1";

  const where: any = {};
  if (!includeDeleted) {
    where.deletedAt = null;
  }
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { code: { contains: search } },
      { drawingNo: { contains: search } },
    ];
  }
  if (categoryId) {
    where.categoryId = categoryId;
  }

  const materials = await prisma.material.findMany({
    where,
    include: {
      category: { select: { id: true, name: true, code: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(materials);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- body 来自 request.json()，与原内联写法保持一致
function materialFieldsFromBody(body: any, supplierId: string | null | undefined) {
  return {
    code: body.code,
    name: body.name,
    categoryId: body.categoryId,
    spec: body.spec || null,
    materialType: body.materialType || null,
    drawingNo: body.drawingNo || null,
    supplier: body.supplier || null,
    supplierId: supplierId || null,
    unit: body.unit || "件",
    standardPrice: body.standardPrice ? parseFloat(String(body.standardPrice)) : null,
    safetyStock: body.safetyStock ? parseFloat(String(body.safetyStock)) : null,
    minStock: body.minStock ? parseFloat(String(body.minStock)) : null,
    maxStock: body.maxStock ? parseFloat(String(body.maxStock)) : null,
    procurementLeadDays: Math.max(0, Math.trunc(Number(body.procurementLeadDays || 0))),
    safetyStockEnabled: body.safetyStockEnabled === true,
    autoPurchaseDraftEnabled: body.autoPurchaseDraftEnabled === true,
    weight: body.weight ? parseFloat(String(body.weight)) : null,
    remark: body.remark || null,
  };
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canManageMaterialMaster(user)) {
    return NextResponse.json({ error: "无权限操作物料" }, { status: 403 });
  }

  const body = await request.json();
  body.code = typeof body.code === "string" ? body.code.trim() : body.code;

  if (!body.code || !body.name || !body.categoryId) {
    return NextResponse.json({ error: "物料编码、名称和分类为必填项" }, { status: 400 });
  }

  const supplierId = await validateSupplierId(body.supplierId);
  if (body.supplierId && !supplierId) {
    return NextResponse.json({ error: "供应商不存在或已停用" }, { status: 400 });
  }

  // 复活：同编码物料此前只是软删除时，恢复该记录并按本次表单覆盖信息，
  // 历史出入库/库存记录随物料 id 自动接回，编码唯一约束保持不被破坏。
  const deletedHolder = body.code
    ? await prisma.material.findFirst({
        where: { code: body.code, deletedAt: { not: null } },
        select: { id: true },
      })
    : null;

  if (deletedHolder) {
    const stockAgg = await prisma.inventory.aggregate({
      where: { materialId: deletedHolder.id },
      _sum: { quantity: true },
    });
    const revived = await prisma.material.update({
      where: { id: deletedHolder.id },
      data: { ...materialFieldsFromBody(body, supplierId), deletedAt: null, isActive: true },
      include: {
        category: { select: { id: true, name: true, code: true } },
      },
    });
    return NextResponse.json(
      { ...revived, revived: true, revivedStock: Number(stockAgg._sum.quantity ?? 0) },
      { status: 201 }
    );
  }

  let material;
  try {
    material = await prisma.material.create({
      data: materialFieldsFromBody(body, supplierId),
      include: {
        category: { select: { id: true, name: true, code: true } },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return duplicateCodeResponse(body.code);
    }
    throw error;
  }

  return NextResponse.json(material, { status: 201 });
}
