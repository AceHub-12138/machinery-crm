import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canPublishProductionOrder, getSessionUser } from "@/lib/permissions";
import { buildDraftData, isProductionOrderConcurrencyConflict, normalizeDraftInput, normalizeProductionRequestKey, ProductionOrderRequestError } from "@/lib/production-orders";
import { writeOperationLog } from "@/lib/sales-items";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canPublishProductionOrder(user)) return NextResponse.json({ error: "无权限从合同生成生产工单" }, { status: 403 });

  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求数据格式错误" }, { status: 400 });
  }
  const contractId = String(body.contractId || "").trim();
  const lines = Array.isArray(body.lines) ? body.lines : [];
  let requestKey: string;
  try { requestKey = normalizeProductionRequestKey(body.requestKey); }
  catch (error) { return error instanceof ProductionOrderRequestError ? NextResponse.json({ error: error.message }, { status: error.status }) : NextResponse.json({ error: "请求幂等标识无效" }, { status: 400 }); }
  if (!contractId || lines.length === 0) return NextResponse.json({ error: "请选择合同设备明细" }, { status: 400 });
  if (lines.length > 100) return NextResponse.json({ error: "单次最多生成 100 张生产工单" }, { status: 400 });

  try {
    const transactionResult = await prisma.$transaction(async (tx) => {
      const sourceRequestKeys = lines.map((_: unknown, index: number) => `${requestKey}:${index}`);
      const existingOrders = await tx.productionOrder.findMany({ where: { sourceRequestKey: { in: sourceRequestKeys } } });
      if (existingOrders.length > 0) {
        const byRequestKey = new Map(existingOrders.map((order) => [order.sourceRequestKey, order]));
        const replayed = sourceRequestKeys.map((key, index) => {
          const order = byRequestKey.get(key);
          const line = lines[index];
          let sameQuantity = false;
          try { sameQuantity = Boolean(order?.quantity.eq(new Prisma.Decimal(String(line?.quantity || "")))); } catch { /* invalid replay payload */ }
          if (!order || order.createdById !== user.id || order.contractId !== contractId || order.contractItemId !== String(line?.contractItemId || "") || !sameQuantity) {
            throw new ProductionOrderRequestError("批量生产工单幂等标识已用于其他请求", 409);
          }
          return order;
        });
        return { orders: replayed, replayed: true };
      }
      const createdOrders = [];
      for (const [index, line] of lines.entries()) {
        const input = normalizeDraftInput({
          ...line,
          orderNo: line.orderNo,
          contractId,
          contractItemId: line.contractItemId,
          specialRequirements: body.specialRequirements,
          warehouseId: body.warehouseId,
          plannedDate: body.plannedDate,
          responsibleId: body.responsibleId,
          remark: body.remark,
        });
        const data = await buildDraftData(tx, input);
        const created = await tx.productionOrder.create({ data: { ...data, sourceRequestKey: sourceRequestKeys[index], createdById: user.id } });
        await writeOperationLog(tx, {
          userId: user.id,
          action: "CREATE_PRODUCTION_ORDER_FROM_CONTRACT_ITEM",
          entityType: "ProductionOrder",
          entityId: created.id,
          afterData: {
            contractId,
            contractItemId: created.contractItemId,
            quantity: created.quantity,
            orderNo: created.orderNo,
          },
        });
        createdOrders.push(created);
      }
      await writeOperationLog(tx, {
        userId: user.id,
        action: "BATCH_CREATE_PRODUCTION_ORDERS_FROM_CONTRACT",
        entityType: "Contract",
        entityId: contractId,
        afterData: createdOrders.map((order) => ({
          productionOrderId: order.id,
          contractItemId: order.contractItemId,
          quantity: order.quantity,
          orderNo: order.orderNo,
        })),
      });
      return { orders: createdOrders, replayed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ items: transactionResult.orders }, { status: transactionResult.replayed ? 200 : 201 });
  } catch (error: any) {
    if (error?.code === "P2002") return NextResponse.json({ error: "工单编号已存在，请更换后重试" }, { status: 409 });
    if (error instanceof ProductionOrderRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (isProductionOrderConcurrencyConflict(error)) {
      return NextResponse.json({ error: "合同设备数量已被其他操作占用，请刷新后重试" }, { status: 409 });
    }
    throw error;
  }
}
