import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, canManageInventory } from "@/lib/permissions";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canManageInventory(user)) {
    return NextResponse.json({ error: "无权限编辑仓库" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  const warehouse = await prisma.warehouse.update({
    where: { id },
    data: {
      name: body.name,
      code: body.code,
      address: body.address !== undefined ? (body.address || null) : undefined,
      isActive: body.isActive !== undefined ? body.isActive : undefined,
    },
  });

  return NextResponse.json(warehouse);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canManageInventory(user)) {
    return NextResponse.json({ error: "无权限删除仓库" }, { status: 403 });
  }

  const { id } = await params;

  // 检查仓库是否有库存
  const inventoryCount = await prisma.inventory.count({
    where: { warehouseId: id, quantity: { gt: 0 } },
  });

  if (inventoryCount > 0) {
    return NextResponse.json({ error: "仓库仍有库存，无法删除。请先转移所有库存后再操作" }, { status: 400 });
  }

  await prisma.warehouse.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json({ success: true });
}
