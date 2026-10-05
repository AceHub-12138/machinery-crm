import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessERP, canManagePurchaseOrders } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { hasShortageSourceMaterialMismatch, releaseShortageSource, shortageSourceMaterialChangeMessage } from "@/lib/purchase-order-shortage-source";
import { releasePurchaseDemandAllocations } from "@/lib/purchase-demand-links";

type PurchaseOrderItemInput = { materialId?: string; quantity?: string | number; unitPrice?: string | number };

function parsePositiveDecimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? new Prisma.Decimal(parsed).toDecimalPlaces(2) : null;
}

function parseNonNegativeDecimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? new Prisma.Decimal(parsed).toDecimalPlaces(2) : null;
}

function parseDate(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeItems(rawItems: unknown) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return null;
  const items = rawItems.map((raw: PurchaseOrderItemInput, index) => {
    const quantity = parsePositiveDecimal(raw.quantity);
    const unitPrice = parseNonNegativeDecimal(raw.unitPrice);
    return {
      materialId: String(raw.materialId || ""),
      quantity,
      unitPrice,
      amount: quantity && unitPrice ? quantity.mul(unitPrice).toDecimalPlaces(2) : null,
      sortOrder: index,
    };
  });
  if (items.some((item) => !item.materialId || !item.quantity || !item.unitPrice || !item.amount)) return null;
  if (new Set(items.map((item) => item.materialId)).size !== items.length) return null;
  return items as Array<{ materialId: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; amount: Prisma.Decimal; sortOrder: number }>;
}

async function loadPurchaseOrder(id: string) {
  const order = await prisma.purchaseOrder.findFirst({ where: { id, deletedAt: null } });
  if (!order) return null;
  const [items, supplier] = await Promise.all([
    prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: id }, orderBy: { sortOrder: "asc" } }),
    prisma.supplier.findUnique({ where: { id: order.supplierId }, select: { id: true, name: true, isActive: true } }),
  ]);
  return { ...order, items, supplier };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canAccessERP(user)) return NextResponse.json({ error: "无权限访问 ERP" }, { status: 403 });
  const { id } = await params;
  const order = await loadPurchaseOrder(id);
  if (!order) return NextResponse.json({ error: "采购订单不存在" }, { status: 404 });
  if (user.role === "WAREHOUSE" && !["ORDERED", "PARTIAL_RECEIVED", "RECEIVED"].includes(order.status)) {
    return NextResponse.json({ error: "仓库管理只能查看已提交或已批准的采购订单" }, { status: 403 });
  }
  return NextResponse.json(order);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canManagePurchaseOrders(user)) return NextResponse.json({ error: "无权限编辑采购订单" }, { status: 403 });
  const { id } = await params;
  const body = await request.json();
  const existing = await loadPurchaseOrder(id);
  if (!existing) return NextResponse.json({ error: "采购订单不存在" }, { status: 404 });
  if (existing.status !== "DRAFT") return NextResponse.json({ error: "只有草稿状态的采购订单可以编辑" }, { status: 409 });

  const supplierId = String(body.supplierId || "");
  const orderDate = parseDate(body.orderDate);
  const expectedArrivalDate = body.expectedArrivalDate ? parseDate(body.expectedArrivalDate) : null;
  const items = normalizeItems(body.items);
  if (!supplierId || !orderDate || !items || (body.expectedArrivalDate && !expectedArrivalDate)) {
    return NextResponse.json({ error: "请填写供应商、订单日期和有效的采购明细；数量需大于 0，单价不能小于 0，且物料不能重复" }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: { id: supplierId, isActive: true, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!supplier) throw new Error("供应商不存在或已停用");
      const materials = await tx.material.findMany({
        where: { id: { in: items.map((item) => item.materialId) }, isActive: true, deletedAt: null },
        select: { id: true, code: true, name: true, spec: true },
      });
      const materialById = new Map(materials.map((material) => [material.id, material]));
      if (materialById.size !== items.length) throw new Error("采购明细中存在不存在或已停用的物料");
      const activeShortageSources = await tx.purchaseOrderShortageSource.findMany({ where: { purchaseOrderId: id, isActive: true }, select: { id: true, materialId: true } });
      const linkedDemandSources = await tx.purchaseOrderItemSource.count({ where: { purchaseOrderItem: { purchaseOrderId: id } } });
      if (linkedDemandSources > 0) throw new Error("该采购单包含多来源数量分摊，不能通过旧编辑方式重建明细；请在采购需求分摊中调整");
      if (activeShortageSources.length > 0) {
        if (hasShortageSourceMaterialMismatch(activeShortageSources.map((source) => source.materialId), items.map((item) => item.materialId))) {
          throw new Error(shortageSourceMaterialChangeMessage);
        }
      }

      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          supplierId: supplier.id,
          supplierNameSnapshot: supplier.name,
          orderDate,
          expectedArrivalDate,
          remark: String(body.remark || "").trim() || null,
        },
      });
      const nextItemData = items.map((item) => {
          const material = materialById.get(item.materialId)!;
          return {
            purchaseOrderId: id,
            materialId: item.materialId,
            materialCodeSnapshot: material.code,
            materialNameSnapshot: material.name,
            materialSpecSnapshot: material.spec,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
            sortOrder: item.sortOrder,
          };
        });
      if (activeShortageSources.length > 0) {
        const replacementItems = await Promise.all(nextItemData.map((item) => tx.purchaseOrderItem.create({ data: item })));
        const replacementByMaterialId = new Map(replacementItems.map((item) => [item.materialId, item]));
        await Promise.all(activeShortageSources.map((source) => tx.purchaseOrderShortageSource.update({ where: { id: source.id }, data: { purchaseOrderItemId: replacementByMaterialId.get(source.materialId)!.id } })));
        await tx.purchaseOrderItem.deleteMany({ where: { id: { in: existing.items.map((item) => item.id) } } });
      } else {
        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
        await tx.purchaseOrderItem.createMany({ data: nextItemData });
      }
      const afterItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: id }, orderBy: { sortOrder: "asc" } });
      await writeOperationLog(tx, {
        userId: user.id,
        action: "UPDATE_PURCHASE_ORDER",
        entityType: "PurchaseOrder",
        entityId: id,
        beforeData: existing,
        afterData: { ...updated, items: afterItems },
      });
    });
  } catch (error) {
    if (error instanceof Error && ["供应商不存在或已停用", "采购明细中存在不存在或已停用的物料", shortageSourceMaterialChangeMessage].includes(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  return NextResponse.json(await loadPurchaseOrder(id));
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canManagePurchaseOrders(user)) return NextResponse.json({ error: "无权限删除采购草稿" }, { status: 403 });
  const { id } = await params;
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.purchaseOrder.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new Error("采购订单不存在");
      if (existing.status !== "DRAFT") throw new Error("只有草稿状态的采购订单可以删除");
      const deletedAt = new Date();
      const deleted = await tx.purchaseOrder.updateMany({ where: { id, status: "DRAFT", deletedAt: null }, data: { deletedAt } });
      if (deleted.count !== 1) throw new Error("采购订单已被其他操作更新，请刷新后重试");
      const releasedDemandAllocations = await releasePurchaseDemandAllocations(tx, id);
      const releasedSources = await tx.purchaseOrderShortageSource.updateMany({ where: { purchaseOrderId: id, isActive: true }, data: releaseShortageSource(deletedAt) });
      await writeOperationLog(tx, {
        userId: user.id,
        action: "DELETE_PURCHASE_ORDER_DRAFT",
        entityType: "PurchaseOrder",
        entityId: id,
        beforeData: existing,
        afterData: { deletedAt, releasedShortageSourceCount: releasedSources.count, releasedDemandAllocations },
      });
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (error.message === "采购订单不存在") return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json({ success: true });
}
