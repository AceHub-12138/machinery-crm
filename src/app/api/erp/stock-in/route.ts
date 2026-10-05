import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessERP, canManageInventory } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { enqueueKitRechecks } from "@/lib/kit-recheck";
import { normalizeManualDocumentNo } from "@/lib/production-orders";
import { resolveStockInBatchNo, stockInAutoNumberPrefix } from "@/lib/document-number";
import { allocatePurchaseReceiptToBatches } from "@/lib/purchase-delivery-receipts";
import {
  lockAndValidatePurchaseReceipt,
  PurchaseReceiptError,
  reconcilePurchaseOrderReceiptStatus,
  type PurchaseReceiptLine,
} from "@/lib/purchase-order-receipt";

type PurchaseStockInItem = {
  materialId: string;
  purchaseOrderItemId: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  amount: Prisma.Decimal;
};

function parseFilterDate(value: string, endOfDay: boolean): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDecimal(value: unknown, allowZero: boolean) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || (allowZero ? numberValue < 0 : numberValue <= 0)) return null;
  return new Prisma.Decimal(numberValue).toDecimalPlaces(2);
}

function normalizePurchaseStockInItems(rawItems: unknown): PurchaseStockInItem[] | null {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return null;
  const items = rawItems.map((raw) => {
    const item = raw as Record<string, unknown>;
    const quantity = parseDecimal(item.quantity, false);
    const unitPrice = parseDecimal(item.unitPrice, true);
    return {
      materialId: typeof item.materialId === "string" ? item.materialId.trim() : "",
      purchaseOrderItemId: typeof item.purchaseOrderItemId === "string" ? item.purchaseOrderItemId.trim() : "",
      quantity,
      unitPrice,
    };
  });
  if (items.some((item) => !item.materialId || !item.purchaseOrderItemId || !item.quantity || !item.unitPrice)) return null;
  if (new Set(items.map((item) => item.purchaseOrderItemId)).size !== items.length) return null;

  return items.map((item) => ({
    materialId: item.materialId,
    purchaseOrderItemId: item.purchaseOrderItemId,
    quantity: item.quantity!,
    unitPrice: item.unitPrice!,
    amount: item.quantity!.mul(item.unitPrice!).toDecimalPlaces(2),
  }));
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
  const warehouseId = searchParams.get("warehouseId") || "";
  const type = searchParams.get("type") || "";
  const createdById = searchParams.get("createdById") || "";
  const status = searchParams.get("status") || "";
  const search = searchParams.get("search")?.trim() || "";
  const dateFromRaw = searchParams.get("dateFrom") || "";
  const dateToRaw = searchParams.get("dateTo") || "";
  const dateFrom = dateFromRaw ? parseFilterDate(dateFromRaw, false) : null;
  const dateTo = dateToRaw ? parseFilterDate(dateToRaw, true) : null;
  if ((dateFromRaw && !dateFrom) || (dateToRaw && !dateTo) || (dateFrom && dateTo && dateFrom > dateTo)) {
    return NextResponse.json({ error: "日期筛选条件无效" }, { status: 400 });
  }
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));

  const where: any = {};
  if (warehouseId) where.warehouseId = warehouseId;
  if (type) where.type = type;
  if (createdById) where.createdById = createdById;
  if (status === "CONFIRMED" || status === "VOIDED") where.status = status;
  if (status && status !== "CONFIRMED" && status !== "VOIDED") return NextResponse.json({ error: "入库状态筛选参数无效" }, { status: 400 });
  if (dateFrom || dateTo) where.createdAt = { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) };
  if (search) {
    where.OR = [
      { batchNo: { contains: search } },
      { items: { some: { OR: [{ materialCodeSnapshot: { contains: search } }, { materialNameSnapshot: { contains: search } }] } } },
    ];
  }

  const skip = (page - 1) * pageSize;

  const [stockIns, total] = await Promise.all([
    prisma.stockIn.findMany({
      where,
      include: {
        warehouse: { select: { id: true, name: true, code: true } },
        items: {
          include: {
            material: { select: { id: true, name: true, code: true, spec: true, unit: true } },
          },
          orderBy: { sortOrder: "asc" },
        },
        voidRecord: { select: { id: true, createdAt: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.stockIn.count({ where }),
  ]);
  const purchaseOrderIds = Array.from(new Set(stockIns.map((stockIn) => stockIn.purchaseOrderId).filter(Boolean))) as string[];
  const voidedByIds = Array.from(new Set(stockIns.map((stockIn) => stockIn.voidedById).filter(Boolean))) as string[];
  const purchaseOrders = purchaseOrderIds.length > 0
    ? await prisma.purchaseOrder.findMany({
      where: { id: { in: purchaseOrderIds }, deletedAt: null },
      select: { id: true, orderNo: true, status: true },
    })
    : [];
  const voidedByUsers = voidedByIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: voidedByIds } }, select: { id: true, name: true } })
    : [];
  const purchaseOrderById = new Map(purchaseOrders.map((order) => [order.id, order]));
  const voidedByUserById = new Map(voidedByUsers.map((user) => [user.id, user]));

  return NextResponse.json({
    items: stockIns.map((stockIn) => ({
      ...stockIn,
      purchaseOrder: stockIn.purchaseOrderId ? purchaseOrderById.get(stockIn.purchaseOrderId) || null : null,
      voidedBy: stockIn.voidedById ? voidedByUserById.get(stockIn.voidedById) || null : null,
    })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canManageInventory(user)) {
    return NextResponse.json({ error: "无权限操作入库" }, { status: 403 });
  }

  const body = await request.json();
  if (!body.warehouseId || !body.items || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "仓库和入库明细为必填项" }, { status: 400 });
  }

  const ids = body.items.map((item: any) => item.materialId);
  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: "同一张单里物料不能重复，请合并为一行" }, { status: 400 });
  }

  const purchaseOrderId = typeof body.purchaseOrderId === "string" ? body.purchaseOrderId.trim() : "";
  const productionOrderId = typeof body.productionOrderId === "string" ? body.productionOrderId.trim() : "";
  if (purchaseOrderId && productionOrderId) {
    return NextResponse.json({ error: "入库单不能同时关联采购订单和生产工单" }, { status: 400 });
  }
  const purchaseItems = purchaseOrderId ? normalizePurchaseStockInItems(body.items) : null;
  if (purchaseOrderId && body.type && body.type !== "PURCHASE") {
    return NextResponse.json({ error: "采购订单入库的类型必须为采购入库" }, { status: 400 });
  }
  if (purchaseOrderId && !purchaseItems) {
    return NextResponse.json({ error: "采购入库明细必须填写有效数量、单价和采购订单明细关联，且同一采购明细不能重复" }, { status: 400 });
  }
  if (productionOrderId && body.type && body.type !== "RETURN") {
    return NextResponse.json({ error: "关联生产工单的入库类型必须为生产退料" }, { status: 400 });
  }
  if (productionOrderId && body.items.some((item: any) => !item.materialId || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0)) {
    return NextResponse.json({ error: "生产退料明细必须填写有效物料和大于 0 的数量" }, { status: 400 });
  }

  const rawBatchNo = typeof body.batchNo === "string" ? body.batchNo.trim() : "";
  let manualBatchNo: string | null = null;
  if (rawBatchNo) {
    try { manualBatchNo = normalizeManualDocumentNo(rawBatchNo, "入库单号"); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "入库单号无效" }, { status: 400 }); }
  }
  const autoBatchNoDate = new Date();
  const autoBatchNoPrefix = stockInAutoNumberPrefix(autoBatchNoDate);
  const inputStockInItems = purchaseItems || body.items.map((item: any) => ({
    materialId: item.materialId,
    purchaseOrderItemId: null,
    quantity: parseFloat(item.quantity),
    unitPrice: parseFloat(item.unitPrice),
    amount: parseFloat(item.quantity) * parseFloat(item.unitPrice),
  }));

  for (let attempt = 0; attempt < 3; attempt += 1) try {
    const stockIn = await prisma.$transaction(
      async (tx) => {
        const batchNo = resolveStockInBatchNo(
          manualBatchNo,
          (await tx.stockIn.findMany({ where: { batchNo: { startsWith: autoBatchNoPrefix } }, select: { batchNo: true } })).map((stockIn) => stockIn.batchNo),
          autoBatchNoDate,
        );
        if (productionOrderId) {
          const productionOrder = await tx.productionOrder.findFirst({ where: { id: productionOrderId, deletedAt: null } });
          if (!productionOrder) throw new Error("生产工单不存在");
          if (productionOrder.status === "DRAFT" || productionOrder.status === "CANCELLED") throw new Error("仅已下达且未取消的生产工单可以退料");
          if (productionOrder.warehouseId !== body.warehouseId) throw new Error("生产退料仓库必须与生产工单仓库一致");
          const [required, issuedDocuments, returnedDocuments] = await Promise.all([
            tx.productionOrderMaterial.findMany({ where: { productionOrderId }, select: { materialId: true } }),
            tx.stockOut.findMany({ where: { productionOrderId }, include: { items: true } }),
            tx.stockIn.findMany({ where: { productionOrderId, status: "CONFIRMED" }, include: { items: true } }),
          ]);
          const requiredIds = new Set(required.map((item) => item.materialId));
          if (body.items.some((item: any) => !requiredIds.has(item.materialId))) throw new Error("退料物料不在该生产工单的物料快照中");
          const issuedByMaterial = new Map<string, number>();
          const returnedByMaterial = new Map<string, number>();
          for (const document of issuedDocuments) for (const item of document.items) issuedByMaterial.set(item.materialId, (issuedByMaterial.get(item.materialId) || 0) + Number(item.quantity));
          for (const document of returnedDocuments) for (const item of document.items) returnedByMaterial.set(item.materialId, (returnedByMaterial.get(item.materialId) || 0) + Number(item.quantity));
          for (const item of body.items) {
            if (Number(item.quantity) + (returnedByMaterial.get(item.materialId) || 0) > (issuedByMaterial.get(item.materialId) || 0)) {
              throw new Error("退料数量不能超过该工单已领未退的数量");
            }
          }
        }
        const stockInItems = productionOrderId
          ? await Promise.all(inputStockInItems.map(async (item: PurchaseStockInItem) => {
              const inventory = await tx.inventory.findUnique({ where: { warehouseId_materialId: { warehouseId: body.warehouseId, materialId: item.materialId } }, select: { avgPrice: true } });
              const unitPrice = Number(item.unitPrice) > 0 ? Number(item.unitPrice) : Number(inventory?.avgPrice || 0);
              return { ...item, unitPrice, amount: Number(item.quantity) * unitPrice };
            }))
          : inputStockInItems;
        let lockedPurchaseOrder: Awaited<ReturnType<typeof lockAndValidatePurchaseReceipt>>["order"] | null = null;
        if (purchaseOrderId && purchaseItems) {
          const purchaseReceiptLines: PurchaseReceiptLine[] = purchaseItems.map((item) => ({
            purchaseOrderItemId: item.purchaseOrderItemId,
            materialId: item.materialId,
            quantity: item.quantity,
          }));
          const locked = await lockAndValidatePurchaseReceipt(tx, purchaseOrderId, purchaseReceiptLines);
          lockedPurchaseOrder = locked.order;
        }

        const warehouseSnapshot = await tx.warehouse.findUnique({ where: { id: body.warehouseId }, select: { name: true, code: true } });
        if (!warehouseSnapshot) throw new Error("仓库不存在");
        const snapshotItems = await Promise.all(stockInItems.map(async (item: any) => {
          const [material, inventory] = await Promise.all([
            tx.material.findFirst({ where: { id: item.materialId, deletedAt: null }, select: { code: true, name: true, spec: true, unit: true } }),
            tx.inventory.findUnique({ where: { warehouseId_materialId: { warehouseId: body.warehouseId, materialId: item.materialId } }, select: { quantity: true } }),
          ]);
          if (!material) throw new Error("入库物料不存在或已删除");
          const beforeQty = new Prisma.Decimal(inventory?.quantity || 0);
          return { ...item, material, beforeQty, afterQty: beforeQty.add(item.quantity) };
        }));
        const header = await tx.stockIn.create({
          data: {
            batchNo,
            warehouseId: body.warehouseId,
            purchaseOrderId: purchaseOrderId || null,
            productionOrderId: productionOrderId || null,
            type: purchaseOrderId ? "PURCHASE" : productionOrderId ? "RETURN" : body.type || "PURCHASE",
            remark: body.remark || null,
            createdById: user.id,
            confirmedById: user.id,
            confirmedAt: new Date(),
            status: "CONFIRMED",
            sourceDocumentSnapshot: { purchaseOrderId: purchaseOrderId || null, productionOrderId: productionOrderId || null, reason: body.remark || null },
            items: {
              create: snapshotItems.map((item: any, index: number) => ({
                materialId: item.materialId,
                purchaseOrderItemId: item.purchaseOrderItemId || null,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                amount: item.amount,
                materialCodeSnapshot: item.material.code,
                materialNameSnapshot: item.material.name,
                materialSpecSnapshot: item.material.spec,
                unitSnapshot: item.material.unit,
                warehouseSnapshot: `${warehouseSnapshot.code} ${warehouseSnapshot.name}`,
                beforeQty: item.beforeQty,
                afterQty: item.afterQty,
                sortOrder: index,
              })),
            },
          },
          include: {
            warehouse: { select: { id: true, name: true, code: true } },
            items: {
              include: {
                material: { select: { id: true, name: true, code: true, spec: true, unit: true } },
              },
              orderBy: { sortOrder: "asc" },
            },
          },
        });

        for (const item of snapshotItems) {
          const qty = Number(item.quantity);
          const unitPrice = Number(item.unitPrice);
          const amount = Number(item.amount);
          const existing = await tx.inventory.findUnique({
            where: {
              warehouseId_materialId: {
                warehouseId: body.warehouseId,
                materialId: item.materialId,
              },
            },
          });

          const beforeQty = existing ? Number(existing.quantity) : 0;
          const beforeAmount = existing ? Number(existing.totalAmount) : 0;
          const newQty = beforeQty + qty;
          const newAmount = beforeAmount + amount;
          const avgPrice = newQty > 0 ? newAmount / newQty : null;

          await tx.inventory.upsert({
            where: {
              warehouseId_materialId: {
                warehouseId: body.warehouseId,
                materialId: item.materialId,
              },
            },
            create: {
              warehouseId: body.warehouseId,
              materialId: item.materialId,
              quantity: qty,
              totalAmount: amount,
              avgPrice: unitPrice,
            },
            update: {
              quantity: newQty,
              totalAmount: newAmount,
              avgPrice,
            },
          });

          await tx.stockMovement.create({
            data: {
              warehouseId: body.warehouseId,
              materialId: item.materialId,
              type: "STOCK_IN",
              quantity: qty,
              beforeQty,
              afterQty: newQty,
              refType: "StockIn",
              refId: header.id,
              remark: productionOrderId ? `生产工单退料：${productionOrderId}` : null,
              createdById: user.id,
            },
          });
        }

        if (purchaseOrderId && purchaseItems && lockedPurchaseOrder) {
          for (const item of purchaseItems) {
            const currentItem = await tx.purchaseOrderItem.findUnique({ where: { id: item.purchaseOrderItemId } });
            if (!currentItem) throw new PurchaseReceiptError("采购明细不存在", 404);
            const receivedAfter = new Prisma.Decimal(currentItem.receivedQuantity).add(item.quantity);
            await tx.purchaseOrderItem.update({
              where: { id: item.purchaseOrderItemId },
              data: { receivedQuantity: { increment: item.quantity }, deliveryStatus: receivedAfter.gte(currentItem.quantity) ? "FULLY_RECEIVED" : "PARTIAL_RECEIVED", actualArrivalDate: receivedAfter.gte(currentItem.quantity) ? new Date() : currentItem.actualArrivalDate },
            });
            let remainingReceipt = new Prisma.Decimal(item.quantity);
            const allocations = await tx.purchaseOrderItemSource.findMany({ where: { purchaseOrderItemId: item.purchaseOrderItemId }, orderBy: { createdAt: "asc" } });
            for (const allocation of allocations) {
              if (remainingReceipt.lte(0)) break;
              const open = Prisma.Decimal.max(new Prisma.Decimal(allocation.allocatedQuantity).sub(allocation.fulfilledQuantity), 0);
              const applied = Prisma.Decimal.min(open, remainingReceipt);
              if (applied.gt(0)) await tx.purchaseOrderItemSource.update({ where: { id: allocation.id }, data: { fulfilledQuantity: { increment: applied } } });
              remainingReceipt = remainingReceipt.sub(applied);
            }
            const stockInItem = header.items.find((row) => row.purchaseOrderItemId === item.purchaseOrderItemId);
            if (!stockInItem) throw new PurchaseReceiptError("入库单采购明细快照不完整", 409);
            await allocatePurchaseReceiptToBatches(tx, { purchaseOrderItemId: item.purchaseOrderItemId, stockInItemId: stockInItem.id, quantity: item.quantity, arrivedAt: header.confirmedAt || new Date() });
          }
          await reconcilePurchaseOrderReceiptStatus(tx, {
            purchaseOrderId,
            currentStatus: lockedPurchaseOrder.status,
            userId: user.id,
          });
        }

        if (productionOrderId) {
          await writeOperationLog(tx, {
            userId: user.id,
            action: "RETURN_PRODUCTION_MATERIALS",
            entityType: "ProductionOrder",
            entityId: productionOrderId,
            afterData: { stockInId: header.id, items: header.items },
          });
        }
        await writeOperationLog(tx, { userId: user.id, action: "CREATE_STOCK_IN", entityType: "StockIn", entityId: header.id, afterData: { batchNo: header.batchNo, warehouseId: header.warehouseId, type: header.type, items: header.items } });
        await enqueueKitRechecks(tx, { warehouseId: body.warehouseId, materialIds: snapshotItems.map((item) => item.materialId), reason: `入库单 ${header.batchNo} 变更库存`, requestedById: user.id });

        return header;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return NextResponse.json(stockIn, { status: 201 });
  } catch (error) {
    if (error instanceof PurchaseReceiptError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && (error.message.includes("生产工单") || error.message.includes("退料"))) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const prismaError = error as { code?: string; message?: string };
    if (manualBatchNo === null && (prismaError?.code === "P2002" || prismaError?.code === "P2034" || /deadlock|serialization/i.test(String(prismaError?.message))) && attempt < 2) continue;
    if (prismaError?.code === "P2002") return NextResponse.json({ error: "入库单号已存在，请更换后重试" }, { status: 409 });
    if (prismaError?.code === "P2034" || /deadlock|serialization/i.test(String(prismaError?.message))) {
      return NextResponse.json({ error: "操作太频繁，请重试" }, { status: 409 });
    }
    throw error;
  }
  return NextResponse.json({ error: "自动生成入库单号发生并发冲突，请重试" }, { status: 409 });
}
