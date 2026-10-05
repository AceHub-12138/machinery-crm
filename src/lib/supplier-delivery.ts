import { PurchaseDeliveryStatus } from "@prisma/client";

const dayMs = 24 * 60 * 60 * 1000;
export function daysUntil(date: Date | null, now = new Date()) {
  if (!date) return null;
  return Math.ceil((new Date(date.toISOString().slice(0, 10)).getTime() - new Date(now.toISOString().slice(0, 10)).getTime()) / dayMs);
}

export function deliveryStatusFor(input: { quantity: number; receivedQuantity: number; latestPromisedDate: Date | null; closed?: boolean }, now = new Date()): PurchaseDeliveryStatus {
  if (input.closed) return "CLOSED";
  if (input.receivedQuantity >= input.quantity) return "FULLY_RECEIVED";
  const overdue = input.latestPromisedDate ? daysUntil(input.latestPromisedDate, now)! < 0 : false;
  if (overdue && input.receivedQuantity > 0) return "OVERDUE_PARTIAL_RECEIVED";
  if (overdue) return "OVERDUE_NOT_RECEIVED";
  if (input.receivedQuantity > 0) return "PARTIAL_RECEIVED";
  return "NOT_DELIVERED";
}

export function deliveryRisk(input: {
  latestPromisedDate: Date | null;
  needArrivalDate: Date | null;
  actualShipDate: Date | null;
  receivedQuantity: number;
  quantity: number;
  lastFollowedAt: Date | null;
  hasDelayRisk: boolean;
  attentionDays: number;
  highRiskDays: number;
}, now = new Date()) {
  if (input.receivedQuantity >= input.quantity) return { level: "NORMAL", days: 0, affectsProduction: false };
  const days = daysUntil(input.latestPromisedDate || input.needArrivalDate, now);
  const affectsProduction = Boolean(input.latestPromisedDate && input.needArrivalDate && input.latestPromisedDate > input.needArrivalDate);
  if (days !== null && days < 0) return { level: "OVERDUE", days, affectsProduction };
  if (input.hasDelayRisk || affectsProduction || (days !== null && days < input.highRiskDays && !input.actualShipDate)) return { level: "HIGH_RISK", days, affectsProduction };
  const staleFollowUp = !input.lastFollowedAt || now.getTime() - input.lastFollowedAt.getTime() >= input.attentionDays * dayMs;
  if (staleFollowUp || (days !== null && days < input.attentionDays)) return { level: "ATTENTION", days, affectsProduction };
  return { level: "NORMAL", days, affectsProduction };
}

export function canManageDeliveryItem(user: { id: string; role: string }, item: { responsibleId: string | null }, order: { createdById: string }) {
  return user.role === "SUPER_ADMIN" || (user.role === "PURCHASE" && (item.responsibleId === user.id || order.createdById === user.id));
}
