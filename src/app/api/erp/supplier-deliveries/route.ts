import { NextRequest, NextResponse } from "next/server";
import { ProcurementSourceType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessERP } from "@/lib/permissions";
import { deliveryRisk, deliveryStatusFor } from "@/lib/supplier-delivery";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canAccessERP(user)) return NextResponse.json({ error: "无权限" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const orders = await prisma.purchaseOrder.findMany({
    where: { deletedAt: null, status: { in: ["ORDERED", "PARTIAL_RECEIVED"] }, ...(params.get("supplierId") ? { supplierId: params.get("supplierId")! } : {}) },
    orderBy: { orderDate: "desc" },
  });
  const items = orders.length ? await prisma.purchaseOrderItem.findMany({
    where: { purchaseOrderId: { in: orders.map((order) => order.id) }, ...(user.role === "PURCHASE" ? { OR: [{ responsibleId: user.id }, { purchaseOrderId: { in: orders.filter((order) => order.createdById === user.id).map((order) => order.id) } }] } : {}), ...(params.get("material") ? { OR: [{ materialCodeSnapshot: { contains: params.get("material")! } }, { materialNameSnapshot: { contains: params.get("material")! } }] } : {}) },
    include: { demandSources: { include: { purchaseDemand: true } }, followUps: { orderBy: { followedAt: "desc" }, take: 1 }, promiseHistory: { orderBy: { changedAt: "desc" } }, deliveryBatches: true },
  }) : [];
  const config = await prisma.procurementConfig.findUnique({ where: { id: "default" } }) || { attentionDays: 7, highRiskDays: 3, urgentDays: 1 };
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const rows = items.map((item) => {
    const order = orderById.get(item.purchaseOrderId)!;
    const last = item.followUps[0] || null;
    const risk = deliveryRisk({ latestPromisedDate: item.latestPromisedDate, needArrivalDate: item.needArrivalDate, actualShipDate: item.actualShipDate, receivedQuantity: Number(item.receivedQuantity), quantity: Number(item.quantity), lastFollowedAt: last?.followedAt || null, hasDelayRisk: Boolean(last?.hasDelayRisk), attentionDays: config.attentionDays, highRiskDays: config.highRiskDays });
    return { ...item, orderNo: order.orderNo, supplierId: order.supplierId, supplier: order.supplierNameSnapshot, remainingQuantity: Math.max(Number(item.quantity) - Number(item.receivedQuantity), 0), sourceTypes: [...new Set(item.demandSources.map((source) => source.purchaseDemand.sourceType))], risk, calculatedDeliveryStatus: deliveryStatusFor({ quantity: Number(item.quantity), receivedQuantity: Number(item.receivedQuantity), latestPromisedDate: item.latestPromisedDate }), lastFollowUp: last };
  }).filter((row) => {
    if (params.get("risk") && row.risk.level !== params.get("risk")) return false;
    if (params.get("sourceType") && !row.sourceTypes.includes(params.get("sourceType") as ProcurementSourceType)) return false;
    if (params.get("responsibleId") && row.responsibleId !== params.get("responsibleId")) return false;
    if (params.get("affectsProduction") === "1" && !row.risk.affectsProduction) return false;
    if (params.get("receipt") === "partial" && !["PARTIAL_RECEIVED", "OVERDUE_PARTIAL_RECEIVED"].includes(row.calculatedDeliveryStatus)) return false;
    if (params.get("shipment") === "unshipped" && row.actualShipDate) return false;
    if (params.get("shipment") === "shipped" && !row.actualShipDate) return false;
    const due = params.get("due");
    if (due) {
      const days = row.risk.days;
      if (days === null) return false;
      if (due === "today" && days !== 0) return false;
      if (due === "3" && (days < 0 || days > 3)) return false;
      if (due === "7" && (days < 0 || days > 7)) return false;
      if (due === "overdue" && days >= 0) return false;
    }
    return true;
  });
  return NextResponse.json({ items: rows, config });
}
