import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessERP, canManageInventory } from "@/lib/permissions";
import { enqueueKitRechecks } from "@/lib/kit-recheck";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canManageInventory(user)) {
    return NextResponse.json({ error: "无权限访问 ERP" }, { status: 403 });
  }

  const { id } = await params;

  const stockCheck = await prisma.stockCheck.findUnique({
    where: { id },
    include: {
      warehouse: { select: { id: true, name: true, code: true } },
      items: {
        include: {
          material: { select: { id: true, name: true, code: true, spec: true, unit: true, standardPrice: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!stockCheck) {
    return NextResponse.json({ error: "盘点单不存在" }, { status: 404 });
  }

  return NextResponse.json(stockCheck);
}

// PUT: 提交盘点单（DRAFT → DONE），更新库存并写入流水
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canManageInventory(user)) {
    return NextResponse.json({ error: "无权限提交盘点" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  const existing = await prisma.stockCheck.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "盘点单不存在" }, { status: 404 });
  }

  if (existing.status !== "DRAFT") {
    return NextResponse.json({ error: "只能提交草稿状态的盘点单" }, { status: 400 });
  }

  try {
    const stockCheck = await prisma.$transaction(
      async (tx) => {
        // 更新盘点项目（如有差异数据）
        if (body.items && Array.isArray(body.items)) {
          for (const item of body.items) {
            const checkItem = existing.items.find((i) => i.id === item.id);
            if (!checkItem) continue;

            const actualQty = item.actualQty !== undefined && item.actualQty !== null
              ? parseFloat(item.actualQty)
              : null;
            const bookQty = Number(checkItem.bookQty);
            const diffQty = actualQty !== null ? actualQty - bookQty : null;

            // 计算差异金额：差异量 × 标准价或均价
            let diffAmount: number | null = null;
            if (diffQty !== null && diffQty !== 0) {
              const material = await tx.material.findUnique({
                where: { id: checkItem.materialId },
                select: { standardPrice: true },
              });
              if (material?.standardPrice) {
                diffAmount = diffQty * Number(material.standardPrice);
              }
            }

            await tx.stockCheckItem.update({
              where: { id: item.id },
              data: {
                actualQty: actualQty,
                diffQty: diffQty,
                diffAmount: diffAmount,
                reason: item.reason !== undefined ? item.reason : undefined,
              },
            });

            // 如果差异不为 0，更新库存并写入流水
            if (diffQty !== null && diffQty !== 0) {
              const inventory = await tx.inventory.findUnique({
                where: {
                  warehouseId_materialId: {
                    warehouseId: existing.warehouseId,
                    materialId: checkItem.materialId,
                  },
                },
              });

              const beforeQty = inventory ? Number(inventory.quantity) : 0;
              const beforeAmount = inventory ? Number(inventory.totalAmount) : 0;
              const newQty = beforeQty + diffQty;
              const newAmount = beforeAmount + (diffAmount || 0);

              await tx.inventory.upsert({
                where: {
                  warehouseId_materialId: {
                    warehouseId: existing.warehouseId,
                    materialId: checkItem.materialId,
                  },
                },
                create: {
                  warehouseId: existing.warehouseId,
                  materialId: checkItem.materialId,
                  quantity: diffQty,
                  totalAmount: diffAmount || 0,
                  avgPrice: diffAmount !== null && diffQty !== 0 ? diffAmount / diffQty : null,
                },
                update: {
                  quantity: newQty,
                  totalAmount: Math.max(0, newAmount),
                  avgPrice: newQty > 0 ? Math.max(0, newAmount) / newQty : null,
                },
              });

              // 写入流水
              await tx.stockMovement.create({
                data: {
                  warehouseId: existing.warehouseId,
                  materialId: checkItem.materialId,
                  type: "CHECK_ADJUST",
                  quantity: diffQty,
                  beforeQty: beforeQty,
                  afterQty: newQty,
                  refType: "StockCheck",
                  refId: existing.id,
                  remark: `盘点调整：${item.reason || "盘点差异"}`,
                  createdById: user.id,
                },
              });
            }
          }
        }

        const changedMaterialIds = (body.items || []).flatMap((item: any) => {
          const original = existing.items.find((row) => row.id === item.id);
          return original && item.actualQty !== undefined && Number(item.actualQty) !== Number(original.bookQty) ? [original.materialId] : [];
        });
        if (changedMaterialIds.length) {
          await enqueueKitRechecks(tx, { warehouseId: existing.warehouseId, materialIds: changedMaterialIds, reason: `盘点单 ${existing.batchNo} 调整库存`, requestedById: user.id });
        }
        // 更新盘点单状态为 DONE
        const updated = await tx.stockCheck.update({
          where: { id },
          data: { status: "DONE" },
          include: {
            warehouse: { select: { id: true, name: true, code: true } },
            items: {
              include: {
                material: { select: { id: true, name: true, code: true, spec: true, unit: true, standardPrice: true } },
              },
              orderBy: { sortOrder: "asc" },
            },
          },
        });

        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return NextResponse.json(stockCheck);
  } catch (e: any) {
    if (e?.code === "P2034" || /deadlock|serialization/i.test(String(e?.message))) {
      return NextResponse.json({ error: "操作太频繁，请重试" }, { status: 409 });
    }
    throw e;
  }
}

// DELETE: 仅删除尚未提交的盘点草稿，不回滚库存、不删除已完成盘点记录
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canManageInventory(user)) {
    return NextResponse.json({ error: "无权限删除盘点草稿" }, { status: 403 });
  }

  const { id } = await params;

  const existing = await prisma.stockCheck.findUnique({
    where: { id },
    select: { id: true, status: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "盘点单不存在" }, { status: 404 });
  }

  if (existing.status !== "DRAFT") {
    return NextResponse.json({ error: "已完成盘点单不能删除，请重新创建盘点单或走管理员纠错流程" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.stockCheckItem.deleteMany({ where: { stockCheckId: id } });
    await tx.stockCheck.delete({ where: { id } });
  });

  return NextResponse.json({ ok: true });
}
