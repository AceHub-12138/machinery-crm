import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessERP, canManageInventory } from "@/lib/permissions";

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
  const onlyActive = searchParams.get("onlyActive") === "1";

  const where: any = {};
  if (onlyActive) {
    where.isActive = true;
  }
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { code: { contains: search } },
    ];
  }

  const warehouses = await prisma.warehouse.findMany({
    where,
    include: {
      _count: {
        select: { inventories: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(warehouses);
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canManageInventory(user)) {
    return NextResponse.json({ error: "无权限操作仓库" }, { status: 403 });
  }

  const body = await request.json();

  if (!body.name || !body.code) {
    return NextResponse.json({ error: "仓库名称和编码为必填项" }, { status: 400 });
  }

  const warehouse = await prisma.warehouse.create({
    data: {
      name: body.name,
      code: body.code,
      address: body.address || null,
    },
  });

  return NextResponse.json(warehouse, { status: 201 });
}
