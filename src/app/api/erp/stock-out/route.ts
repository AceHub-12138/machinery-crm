import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessERP, canManageInventory, isSuperAdmin } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { enqueueKitRechecks } from "@/lib/kit-recheck";
import { normalizeManualDocumentNo } from "@/lib/production-orders";
import { DOCUMENT_NUMBER_RULES_KEY, normalizeAutoDocumentRules, resolveStockOutBatchNo, stockOutAutoNumberPrefix } from "@/lib/document-number";

function parseFilterDate(value: string, endOfDay: boolean): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
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
  if (status === "CONFIRMED") where.confirmedAt = { not: null };
  if (status && status !== "CONFIRMED") return NextResponse.json({ error: "出库状态筛选参数无效" }, { status: 400 });
  if (dateFrom || dateTo) where.createdAt = { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) };
  if (search) {
    where.OR = [
      { batchNo: { contains: search } },
      { items: { some: { OR: [{ materialCodeSnapshot: { contains: search } }, { materialNameSnapshot: { contains: search } }] } } },
    ];
  }

  const skip = (page - 1) * pageSize;

  const [stockOuts, total] = await Promise.all([
    prisma.stockOut.findMany({
      where,
      include: {
        warehouse: { select: { id: true, name: true, code: true } },
        items: {
          include: {
            material: { select: { id: true, name: true, code: true, spec: true, unit: true } },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.stockOut.count({ where }),
  ]);

  return NextResponse.json({
    items: stockOuts,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canManageInventory(user)) {
    return NextResponse.json({ error: "无权限操作出库" }, { status: 403 });
  }

  const body = await request.json();

  if (!body.warehouseId || !body.items || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "仓库和出库明细为必填项" }, { status: 400 });
  }

  const ids = body.items.map((i: any) => i.materialId);
  if (new Set(ids).size !== ids.length) {
    return NextResponse.json(
      { error: "同一张单里物料不能重复，请合并为一行" },
      { status: 400 }
    );
  }

  if (body.items.some((item: any) => !item.materialId || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0)) {
    return NextResponse.json({ error: "出库明细必须填写有效物料和大于 0 的数量" }, { status: 400 });
  }

  const productionOrderId = typeof body.productionOrderId === "string" ? body.productionOrderId.trim() : "";
  const overIssueReason = typeof body.overIssueReason === "string" ? body.overIssueReason.trim() : "";
  const confirmOverIssue = body.confirmOverIssue === true;
  if (productionOrderId && body.type && body.type !== "PRODUCTION") {
    return NextResponse.json({ error: "关联生产工单的出库类型必须为生产领料" }, { status: 400 });
  }

  const rawBatchNo = String(body.batchNo ?? "").trim();
  let manualBatchNo: string | null = null;
  if (rawBatchNo) {
    try { manualBatchNo = normalizeManualDocumentNo(rawBatchNo, "出库单号"); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "出库单号无效" }, { status: 400 }); }
  }
  for (let attempt = 0; attempt < 3; attempt += 1) try {
    const stockOut = await prisma.$transaction(
      async (tx) => {
        let batchNo = manualBatchNo;
        if (!batchNo) {
          const autoBatchNoDate = new Date();
          const numberRule = normalizeAutoDocumentRules((await tx.systemSetting.findUnique({ where: { key: DOCUMENT_NUMBER_RULES_KEY } }))?.value).STOCK_OUT;
          const autoBatchNoPrefix = stockOutAutoNumberPrefix(numberRule, autoBatchNoDate);
          batchNo = resolveStockOutBatchNo(
            null,
            numberRule,
            (await tx.stockOut.findMany({ where: { batchNo: { startsWith: autoBatchNoPrefix } }, select: { batchNo: true } })).map((stockOut) => stockOut.batchNo),
            autoBatchNoDate,
          );
        }
        if (productionOrderId) {
          const productionOrder = await tx.productionOrder.findFirst({ where: { id: productionOrderId, deletedAt: null } });
          if (!productionOrder) throw new Error("生产工单不存在");
          if (productionOrder.status !== "ISSUED") throw new Error("仅已下达且未进入变更审批的生产工单可以领料");
          if (productionOrder.warehouseId !== body.warehouseId) throw new Error("生产领料仓库必须与生产工单仓库一致");
          const [requiredMaterials, issuedDocuments, returnedDocuments] = await Promise.all([
            tx.productionOrderMaterial.findMany({ where: { productionOrderId }, select: { materialId: true, requiredQuantity: true } }),
            tx.stockOut.findMany({ where: { productionOrderId }, include: { items: true } }),
            tx.stockIn.findMany({ where: { productionOrderId, status: "CONFIRMED" }, include: { items: true } }),
          ]);
          const requiredByMaterial = new Map(requiredMaterials.map((item) => [item.materialId, Number(item.requiredQuantity)]));
          const issuedByMaterial = new Map<string, number>();
          const returnedByMaterial = new Map<string, number>();
          for (const document of issuedDocuments) for (const item of document.items) issuedByMaterial.set(item.materialId, (issuedByMaterial.get(item.materialId) || 0) + Number(item.quantity));
          for (const document of returnedDocuments) for (const item of document.items) returnedByMaterial.set(item.materialId, (returnedByMaterial.get(item.materialId) || 0) + Number(item.quantity));
          for (const item of body.items) {
            const required = requiredByMaterial.get(item.materialId);
            if (required === undefined) throw new Error("领料物料不在该生产工单的物料快照中");
            const netIssued = (issuedByMaterial.get(item.materialId) || 0) - (returnedByMaterial.get(item.materialId) || 0);
            if (netIssued + Number(item.quantity) > required) {
              if (!isSuperAdmin(user) || !confirmOverIssue || !overIssueReason) {
                throw new Error("领料数量超过剩余需求量；仅超级管理员确认并填写超领原因后才可继续");
              }
            }
          }
        }

        // 先检查库存是否充足
        for (const item of body.items) {
          const inventory = await tx.inventory.findUnique({
            where: {
              warehouseId_materialId: {
                warehouseId: body.warehouseId,
                materialId: item.materialId,
              },
            },
          });

          const needed = parseFloat(item.quantity);
          const available = inventory ? Number(inventory.quantity) : 0;

          if (available < needed) {
            const material = await tx.material.findUnique({
              where: { id: item.materialId },
              select: { name: true, code: true },
            });
            throw new Error(
              `物料【${material?.name || item.materialId}】库存不足：需要 ${needed}，可用 ${available}`
            );
          }
        }

        const warehouseSnapshot = await tx.warehouse.findUnique({ where: { id: body.warehouseId }, select: { name: true, code: true } });
        if (!warehouseSnapshot) throw new Error("仓库不存在");
        const snapshotItems = await Promise.all(body.items.map(async (item: any) => {
          const [material, inventory] = await Promise.all([
            tx.material.findFirst({ where: { id: item.materialId, deletedAt: null }, select: { code: true, name: true, spec: true, unit: true } }),
            tx.inventory.findUnique({ where: { warehouseId_materialId: { warehouseId: body.warehouseId, materialId: item.materialId } }, select: { quantity: true } }),
          ]);
          if (!material || !inventory) throw new Error("出库物料或库存不存在");
          const beforeQty = new Prisma.Decimal(inventory.quantity);
          return { ...item, material, beforeQty, afterQty: beforeQty.sub(item.quantity) };
        }));
        // 创建出库单头
        const header = await tx.stockOut.create({
          data: {
            batchNo,
            warehouseId: body.warehouseId,
            productionOrderId: productionOrderId || null,
            type: body.type || "PRODUCTION",
            remark: productionOrderId && confirmOverIssue ? `${String(body.remark || "").trim()}${body.remark ? "；" : ""}超领原因：${overIssueReason}` : body.remark || null,
            createdById: user.id,
            confirmedById: user.id,
            confirmedAt: new Date(),
            sourceDocumentSnapshot: { productionOrderId: productionOrderId || null, reason: body.remark || null },
            items: {
              create: snapshotItems.map((item: any, index: number) => ({
                materialId: item.materialId,
                quantity: parseFloat(item.quantity),
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

        // 扣减库存 + 写入流水
        for (const item of body.items) {
          const qty = parseFloat(item.quantity);

          const inventory = await tx.inventory.findUnique({
            where: {
              warehouseId_materialId: {
                warehouseId: body.warehouseId,
                materialId: item.materialId,
              },
            },
          });

          if (!inventory) continue;

          const beforeQty = Number(inventory.quantity);
          const newQty = beforeQty - qty;
          const oldTotal = Number(inventory.totalAmount);
          const avgPrice = beforeQty > 0 ? oldTotal / beforeQty : 0;
          const deductedAmount = avgPrice * qty;
          const newAmount = oldTotal - deductedAmount;

          await tx.inventory.update({
            where: {
              warehouseId_materialId: {
                warehouseId: body.warehouseId,
                materialId: item.materialId,
              },
            },
            data: {
              quantity: newQty,
              totalAmount: Math.max(0, newAmount),
              avgPrice: newQty > 0 ? Math.max(0, newAmount) / newQty : null,
            },
          });

          // 写入流水
          await tx.stockMovement.create({
            data: {
              warehouseId: body.warehouseId,
              materialId: item.materialId,
              type: "STOCK_OUT",
              quantity: -qty,
              beforeQty: beforeQty,
              afterQty: newQty,
              refType: "StockOut",
              refId: header.id,
              remark: productionOrderId ? `生产工单领料：${productionOrderId}` : null,
              createdById: user.id,
            },
          });
        }

        if (productionOrderId) {
          await writeOperationLog(tx, {
            userId: user.id,
            action: "ISSUE_PRODUCTION_MATERIALS",
            entityType: "ProductionOrder",
            entityId: productionOrderId,
            afterData: { stockOutId: header.id, items: header.items, confirmOverIssue, overIssueReason: confirmOverIssue ? overIssueReason : null },
          });
        }
        await writeOperationLog(tx, { userId: user.id, action: "CREATE_STOCK_OUT", entityType: "StockOut", entityId: header.id, afterData: { batchNo: header.batchNo, warehouseId: header.warehouseId, type: header.type, items: header.items } });
        await enqueueKitRechecks(tx, { warehouseId: body.warehouseId, materialIds: snapshotItems.map((item: any) => item.materialId), reason: `出库单 ${header.batchNo} 变更库存`, requestedById: user.id });

        return header;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return NextResponse.json(stockOut, { status: 201 });
  } catch (e: any) {
    if (manualBatchNo === null && (e?.code === "P2002" || e?.code === "P2034" || /deadlock|serialization/i.test(String(e?.message))) && attempt < 2) continue;
    if (e?.code === "P2002") return NextResponse.json({ error: "出库单号已存在，请更换后重试" }, { status: 409 });
    if (e?.code === "P2034" || /deadlock|serialization/i.test(String(e?.message))) {
      return NextResponse.json({ error: "操作太频繁，请重试" }, { status: 409 });
    }
    if (e instanceof Error && (e.message.includes("库存不足") || e.message.includes("生产工单") || e.message.includes("领料"))) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
  return NextResponse.json({ error: "自动生成出库单号发生并发冲突，请重试" }, { status: 409 });
}
