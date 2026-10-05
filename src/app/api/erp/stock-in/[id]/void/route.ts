import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { canVoidStockIn, getSessionUser } from "@/lib/permissions";
import { enqueueKitRechecks } from "@/lib/kit-recheck";
import { writeOperationLog } from "@/lib/sales-items";
import {
  assertStockInCanBeVoided,
  calculateInventoryAfterStockInVoid,
  normalizeStockInVoidReason,
  StockInVoidRequestError,
} from "@/lib/stock-in-void";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canVoidStockIn(user)) return NextResponse.json({ error: "无权限作废入库单" }, { status: 403 });

  const { id } = await params;
  let reason: string;
  try {
    reason = normalizeStockInVoidReason((await request.json()).reason);
  } catch (error) {
    if (error instanceof StockInVoidRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "请求数据格式错误" }, { status: 400 });
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // 先锁单头，再按 materialId 固定顺序锁库存行，避免作废与出入库交错造成死锁。
        await tx.$queryRaw`SELECT id FROM erp_stock_ins WHERE id = ${id} FOR UPDATE`;
        const stockIn = await tx.stockIn.findUnique({
          where: { id },
          include: { items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
        });
        if (!stockIn) throw new StockInVoidRequestError("入库单不存在", 404);
        assertStockInCanBeVoided({ ...stockIn, actorId: user.id });
        if (!stockIn.items.length) throw new StockInVoidRequestError("入库单没有可作废的明细");

        const voidQuantityByMaterial = new Map<string, Prisma.Decimal>();
        for (const item of stockIn.items) {
          const current = voidQuantityByMaterial.get(item.materialId) || new Prisma.Decimal(0);
          voidQuantityByMaterial.set(item.materialId, current.add(item.quantity));
        }
        const materialIds = [...voidQuantityByMaterial.keys()].sort();
        for (const materialId of materialIds) {
          await tx.$queryRaw`SELECT id FROM erp_inventories WHERE warehouseId = ${stockIn.warehouseId} AND materialId = ${materialId} FOR UPDATE`;
        }

        const inventoryByMaterial = new Map<string, { id: string; quantity: Prisma.Decimal; totalAmount: Prisma.Decimal }>();
        for (const materialId of materialIds) {
          const inventory = await tx.inventory.findUnique({
            where: { warehouseId_materialId: { warehouseId: stockIn.warehouseId, materialId } },
            select: { id: true, quantity: true, totalAmount: true },
          });
          const requestedQuantity = voidQuantityByMaterial.get(materialId)!;
          if (!inventory || new Prisma.Decimal(inventory.quantity).lt(requestedQuantity)) {
            throw new StockInVoidRequestError("当前库存不足，已有后续业务使用该入库物料，不能作废");
          }
          inventoryByMaterial.set(materialId, {
            id: inventory.id,
            quantity: new Prisma.Decimal(inventory.quantity),
            totalAmount: new Prisma.Decimal(inventory.totalAmount),
          });
        }

        const voidRecord = await tx.stockInVoid.create({
          data: { stockInId: stockIn.id, voidedById: user.id, reason },
        });
        const voidItems: Array<{ id: string; stockInItemId: string; materialId: string; quantity: Prisma.Decimal; reversalAmount: Prisma.Decimal; beforeQty: Prisma.Decimal; afterQty: Prisma.Decimal }> = [];

        for (const item of stockIn.items) {
          const inventory = inventoryByMaterial.get(item.materialId)!;
          const calculation = calculateInventoryAfterStockInVoid({
            quantity: inventory.quantity,
            totalAmount: inventory.totalAmount,
            voidQuantity: new Prisma.Decimal(item.quantity),
          });
          await tx.inventory.update({
            where: { id: inventory.id },
            data: {
              quantity: calculation.afterQty,
              totalAmount: calculation.afterAmount,
              avgPrice: calculation.avgPrice,
            },
          });
          const voidItem = await tx.stockInVoidItem.create({
            data: {
              stockInVoidId: voidRecord.id,
              stockInItemId: item.id,
              materialId: item.materialId,
              quantity: calculation.voidQuantity,
              reversalAmount: calculation.reversalAmount,
              beforeQty: calculation.beforeQty,
              afterQty: calculation.afterQty,
            },
          });
          await tx.stockMovement.create({
            data: {
              warehouseId: stockIn.warehouseId,
              materialId: item.materialId,
              type: "STOCK_OUT",
              quantity: calculation.voidQuantity.neg(),
              beforeQty: calculation.beforeQty,
              afterQty: calculation.afterQty,
              refType: "StockInVoid",
              refId: voidRecord.id,
              remark: `入库单 ${stockIn.batchNo} 作废冲减：${reason}`,
              createdById: user.id,
            },
          });
          inventoryByMaterial.set(item.materialId, {
            id: inventory.id,
            quantity: calculation.afterQty,
            totalAmount: calculation.afterAmount,
          });
          voidItems.push({
            id: voidItem.id,
            stockInItemId: item.id,
            materialId: item.materialId,
            quantity: calculation.voidQuantity,
            reversalAmount: calculation.reversalAmount,
            beforeQty: calculation.beforeQty,
            afterQty: calculation.afterQty,
          });
        }

        const voidedAt = new Date();
        await tx.stockIn.update({
          where: { id: stockIn.id },
          data: { status: "VOIDED", voidedAt, voidedById: user.id, voidReason: reason },
        });
        await writeOperationLog(tx, {
          userId: user.id,
          action: "VOID_STOCK_IN",
          entityType: "StockIn",
          entityId: stockIn.id,
          beforeData: {
            status: stockIn.status,
            warehouseId: stockIn.warehouseId,
            purchaseOrderId: stockIn.purchaseOrderId,
            productionOrderId: stockIn.productionOrderId,
            items: stockIn.items,
          },
          afterData: { status: "VOIDED", voidedAt, voidRecordId: voidRecord.id, reason, items: voidItems },
        });
        await enqueueKitRechecks(tx, {
          warehouseId: stockIn.warehouseId,
          materialIds,
          reason: `入库单 ${stockIn.batchNo} 作废冲减库存`,
          requestedById: user.id,
        });

        return { id: stockIn.id, batchNo: stockIn.batchNo, status: "VOIDED", voidedAt, voidRecordId: voidRecord.id };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return NextResponse.json(result);
    } catch (error) {
      if ((error as { code?: string })?.code === "P2002" && attempt < 2) continue;
      if ((error as { code?: string })?.code === "P2034" || /deadlock|serialization/i.test(String((error as { message?: string })?.message))) {
        if (attempt < 2) continue;
        return NextResponse.json({ error: "作废操作并发冲突，请刷新后重试" }, { status: 409 });
      }
      if (error instanceof StockInVoidRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
      if ((error as { code?: string })?.code === "P2002") return NextResponse.json({ error: "该入库单已被其他操作作废，请刷新后重试" }, { status: 409 });
      throw error;
    }
  }

  return NextResponse.json({ error: "作废操作并发冲突，请刷新后重试" }, { status: 409 });
}
