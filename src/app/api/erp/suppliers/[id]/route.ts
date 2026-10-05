import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessERP, canManageSuppliers } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { normalizeSupplierInput } from "@/lib/supplier-input";

async function requireErpUser() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  if (!canAccessERP(user)) return { error: NextResponse.json({ error: "无权限访问 ERP" }, { status: 403 }) };
  return { user };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireErpUser();
  if (auth.error) return auth.error;
  if (!canManageSuppliers(auth.user!)) return NextResponse.json({ error: "无权限维护供应商" }, { status: 403 });
  const { id } = await params;
  const supplier = await prisma.supplier.findFirst({ where: { id, deletedAt: null } });
  if (!supplier) return NextResponse.json({ error: "供应商不存在" }, { status: 404 });
  return NextResponse.json(supplier);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireErpUser();
  if (auth.error) return auth.error;
  if (!canManageSuppliers(auth.user!)) return NextResponse.json({ error: "无权限维护供应商" }, { status: 403 });
  const { id } = await params;
  const body = await request.json();
  const existing = await prisma.supplier.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "供应商不存在" }, { status: 404 });

  let input;
  try { input = normalizeSupplierInput(body); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "供应商信息不完整" }, { status: 400 }); }
  const duplicated = await prisma.supplier.findFirst({ where: { name: input.name, deletedAt: null, id: { not: id } }, select: { id: true } });
  if (duplicated) return NextResponse.json({ error: "供应商名称已存在" }, { status: 409 });

  const supplier = await prisma.$transaction(async (tx) => {
    const updated = await tx.supplier.update({
      where: { id },
      data: {
        ...input,
      },
    });
    await writeOperationLog(tx, {
      userId: auth.user!.id,
      action: "UPDATE_SUPPLIER",
      entityType: "Supplier",
      entityId: id,
      beforeData: existing,
      afterData: updated,
    });
    return updated;
  });
  return NextResponse.json(supplier);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireErpUser();
  if (auth.error) return auth.error;
  if (!canManageSuppliers(auth.user!)) return NextResponse.json({ error: "无权限维护供应商" }, { status: 403 });
  const { id } = await params;
  const existing = await prisma.supplier.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "供应商不存在" }, { status: 404 });

  const supplier = await prisma.$transaction(async (tx) => {
    const updated = await tx.supplier.update({ where: { id }, data: { isActive: false } });
    await writeOperationLog(tx, {
      userId: auth.user!.id,
      action: "DISABLE_SUPPLIER",
      entityType: "Supplier",
      entityId: id,
      beforeData: existing,
      afterData: updated,
    });
    return updated;
  });
  return NextResponse.json({ success: true, supplier });
}
