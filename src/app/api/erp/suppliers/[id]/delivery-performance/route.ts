import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, canManagePurchaseOrders } from "@/lib/permissions";

const dayMs = 86400000;
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(); if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canManagePurchaseOrders(user)) return NextResponse.json({ error: "无权限查看供应商绩效" }, { status: 403 });
  const { id } = await params;
  const orders = await prisma.purchaseOrder.findMany({ where: { supplierId: id, deletedAt: null, status: { not: "CANCELLED" } }, select: { id: true } });
  const items = orders.length ? await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: { in: orders.map((row) => row.id) }, receivedQuantity: { gt: 0 } }, include: { promiseHistory: true, deliveryBatches: { include: { receiptAllocations: true } }, demandSources: { include: { purchaseDemand: true } } } }) : [];
  const summarize = (since: Date) => {
    const completed = items.filter((item) => item.actualArrivalDate && item.actualArrivalDate >= since && item.receivedQuantity.gte(item.quantity));
    const delays = completed.map((item) => item.requiredDeliveryDate ? Math.max(0, Math.ceil((item.actualArrivalDate!.getTime() - item.requiredDeliveryDate.getTime()) / dayMs)) : 0);
    const onTime = completed.filter((item) => !item.requiredDeliveryDate || item.actualArrivalDate! <= item.requiredDeliveryDate).length;
    const firstPromiseMet = completed.filter((item) => !item.firstPromisedDate || item.actualArrivalDate! <= item.firstPromisedDate).length;
    const receiptCount = (item: typeof completed[number]) => new Set(item.deliveryBatches.flatMap((batch) => batch.receiptAllocations.map((allocation) => allocation.stockInItemId))).size;
    const completeOnce = completed.filter((item) => receiptCount(item) === 1).length;
    return {
      completedLines: completed.length,
      onTimeDeliveryRate: completed.length ? onTime / completed.length : null,
      firstPromiseFulfillmentRate: completed.length ? firstPromiseMet / completed.length : null,
      completeDeliveryRate: completed.length ? completeOnce / completed.length : null,
      averageDelayDays: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 0,
      maximumDelayDays: delays.length ? Math.max(...delays) : 0,
      delayCount: delays.filter((days) => days > 0).length,
      promiseDateChangeCount: completed.reduce((sum, item) => sum + Math.max(item.promiseHistory.length - 1, 0), 0),
      partialDeliveryCount: completed.filter((item) => receiptCount(item) > 1).length,
      productionImpactCount: completed.filter((item) => item.demandSources.some((source) => source.purchaseDemand.sourceType === "PRODUCTION_ORDER") && item.latestPromisedDate && item.needArrivalDate && item.latestPromisedDate > item.needArrivalDate).length,
    };
  };
  const now = new Date();
  return NextResponse.json({ last3Months: summarize(new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())), last12Months: summarize(new Date(now.getFullYear(), now.getMonth() - 12, now.getDate())) });
}
