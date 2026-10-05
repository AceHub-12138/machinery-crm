import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessERP, canManagePurchaseOrders } from "@/lib/permissions";
import { canManageDeliveryItem } from "@/lib/supplier-delivery";
import { writeOperationLog } from "@/lib/sales-items";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const user = await getSessionUser(); if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canAccessERP(user)) return NextResponse.json({ error: "无权限" }, { status: 403 });
  const { itemId } = await params;
  return NextResponse.json(await prisma.purchaseDeliveryBatch.findMany({ where: { purchaseOrderItemId: itemId }, orderBy: { createdAt: "asc" } }));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const user = await getSessionUser(); if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canManagePurchaseOrders(user)) return NextResponse.json({ error: "无权限" }, { status: 403 });
  const { itemId } = await params; const body = await request.json();
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM erp_purchase_order_items WHERE id = ${itemId} FOR UPDATE`;
      const item = await tx.purchaseOrderItem.findUnique({ where: { id: itemId }, include: { deliveryBatches: true } });
      if (!item) throw new Error("采购明细不存在");
      const order = await tx.purchaseOrder.findUnique({ where: { id: item.purchaseOrderId }, select: { createdById: true } });
      if (!order || !canManageDeliveryItem(user, item, order)) throw new Error("不能修改其他采购负责人数据");
      const planned = new Prisma.Decimal(String(body.plannedQuantity || 0));
      if (!planned.gt(0)) throw new Error("计划到货数量必须大于 0");
      if (Number(body.receivedQuantity || 0) > 0 || body.actualArrivalDate) throw new Error("实际到货只能由采购入库登记，不能在交期页面手工填写");
      const shipped = new Prisma.Decimal(String(body.shippedQuantity || 0));
      if (shipped.lt(0) || shipped.gt(planned)) throw new Error("实际发货数量不能超过本批计划数量");
      if (shipped.gt(0) && !body.actualShipDate) throw new Error("填写实际发货数量时必须填写实际发货日期");
      const totalPlanned = item.deliveryBatches.reduce((sum, row) => sum.add(row.plannedQuantity), new Prisma.Decimal(0)).add(planned);
      if (totalPlanned.gt(item.quantity)) throw new Error("各批次计划数量合计不能超过采购数量");
      const batch=await tx.purchaseDeliveryBatch.create({ data: { purchaseOrderItemId: itemId, plannedQuantity: planned, plannedArrivalDate: body.plannedArrivalDate ? new Date(body.plannedArrivalDate) : null, promisedDate: body.promisedDate ? new Date(body.promisedDate) : null, shippedQuantity: shipped, actualShipDate: body.actualShipDate ? new Date(body.actualShipDate) : null, receivedQuantity: 0, actualArrivalDate: null, trackingNo: body.trackingNo || null, remark: body.remark || null } });
      if (body.actualShipDate && !item.actualShipDate) await tx.purchaseOrderItem.update({ where: { id: itemId }, data: { actualShipDate: new Date(body.actualShipDate) } });
      await writeOperationLog(tx,{userId:user.id,action:"CREATE_PURCHASE_DELIVERY_BATCH",entityType:"PurchaseOrderItem",entityId:itemId,afterData:batch});return batch;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 409 }); }
}
