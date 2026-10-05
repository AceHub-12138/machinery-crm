import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { daysUntil } from "@/lib/supplier-delivery";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  const cronSecret = request.headers.get("x-cron-secret");
  const cronAllowed = Boolean(process.env.ERP_CRON_SECRET && cronSecret === process.env.ERP_CRON_SECRET);
  if (!cronAllowed && (!user || !isSuperAdmin(user))) return NextResponse.json({ error: user ? "仅管理员可执行" : "未授权" }, { status: user ? 403 : 401 });
  const config = await prisma.procurementConfig.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });
  const orders = await prisma.purchaseOrder.findMany({ where: { deletedAt: null, status: { in: ["ORDERED", "PARTIAL_RECEIVED"] } } });
  const items = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: { in: orders.map((row) => row.id) } } });
  const orderById = new Map(orders.map((row) => [row.id, row]));
  const administrators = await prisma.user.findMany({ where: { role: "SUPER_ADMIN", isActive: true }, select: { id: true } });
  let created = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const item of items) {
    if (item.receivedQuantity.gte(item.quantity)) continue;
    const order = orderById.get(item.purchaseOrderId)!;
    const due = item.latestPromisedDate || item.requiredDeliveryDate || item.needArrivalDate;
    const days = daysUntil(due);
    const thresholds = [config.attentionDays, config.highRiskDays, config.urgentDays, 0, -1, -3, -7];
    if (days === null || !thresholds.includes(days)) continue;
    const recipient = item.responsibleId || order.createdById;
    const level = days <= -7 ? "CRITICAL" : days < 0 ? "ERROR" : days <= config.highRiskDays ? "WARNING" : "INFO";
    const key = `DELIVERY:${item.id}:${today}:${days}`;
    try { await prisma.erpNotification.create({ data: { notificationKey: key, userId: recipient, title: days < 0 ? "采购交期已逾期" : "采购交期提醒", content: `${order.orderNo} / ${item.materialNameSnapshot} 距交期 ${days} 天，未到货 ${item.quantity.sub(item.receivedQuantity).toString()}。`, link: "/erp/supplier-deliveries", level } }); created++; } catch (error: any) { if (error?.code !== "P2002") throw error; }
    if (days === -3 || days === -7) for (const admin of administrators) { const adminKey=`${key}:ADMIN:${admin.id}`; try { await prisma.erpNotification.create({data:{notificationKey:adminKey,userId:admin.id,title:days===-7?"采购严重延期":"采购延期升级提醒",content:`${order.orderNo} / ${item.materialNameSnapshot} 已逾期 ${Math.abs(days)} 天，未到货 ${item.quantity.sub(item.receivedQuantity).toString()}。`,link:"/erp/supplier-deliveries",level:days===-7?"CRITICAL":"ERROR"}});created++; } catch(error:any){if(error?.code!=="P2002")throw error;} }
  }
  return NextResponse.json({ checked: items.length, created });
}
