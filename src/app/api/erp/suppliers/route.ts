import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessERP, canManageSuppliers } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { validateNewSupplierInput } from "@/lib/supplier-input";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canAccessERP(user)) return NextResponse.json({ error: "无权限访问 ERP" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() || "";
  const onlyActive = searchParams.get("onlyActive") === "1";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "100", 10)));
  const where: any = { deletedAt: null };
  if (onlyActive) where.isActive = true;
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { contactName: { contains: search } },
      { phone: { contains: search } },
      { mainCategory: { contains: search } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.supplier.count({ where }),
  ]);

  return NextResponse.json({
    items,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canManageSuppliers(user)) return NextResponse.json({ error: "无权限维护供应商" }, { status: 403 });

  const body = await request.json();
  let input;
  try { input = validateNewSupplierInput(body); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "供应商信息不完整" }, { status: 400 }); }

  const duplicated = await prisma.supplier.findFirst({ where: { name: input.name, deletedAt: null }, select: { id: true } });
  if (duplicated) return NextResponse.json({ error: "供应商名称已存在" }, { status: 409 });

  const supplier = await prisma.$transaction(async (tx) => {
    const created = await tx.supplier.create({
      data: {
        ...input,
      },
    });
    await writeOperationLog(tx, {
      userId: user.id,
      action: "CREATE_SUPPLIER",
      entityType: "Supplier",
      entityId: created.id,
      afterData: created,
    });
    return created;
  });

  return NextResponse.json(supplier, { status: 201 });
}
