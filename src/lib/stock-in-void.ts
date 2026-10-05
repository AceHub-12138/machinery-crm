import { Prisma } from "@prisma/client";

export class StockInVoidRequestError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export function canRoleVoidStockIn(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "WAREHOUSE";
}

export function normalizeStockInVoidReason(value: unknown) {
  if (typeof value !== "string") throw new StockInVoidRequestError("作废原因为必填项", 400);
  const reason = value.trim();
  if (reason.length < 5 || reason.length > 500) {
    throw new StockInVoidRequestError("作废原因长度必须为 5 到 500 个字符", 400);
  }
  return reason;
}

export function assertStockInCanBeVoided(input: {
  status: "DRAFT" | "CONFIRMED" | "VOIDED";
  confirmedAt: Date | null;
  voidedAt: Date | null;
  purchaseOrderId: string | null;
  productionOrderId: string | null;
  confirmedById: string | null;
  actorId: string;
}) {
  if (input.status !== "CONFIRMED" || !input.confirmedAt || input.voidedAt) {
    throw new StockInVoidRequestError("仅已确认且未作废的入库单可以作废");
  }
  if (input.purchaseOrderId) {
    throw new StockInVoidRequestError("该入库单来自采购入库，请先通过撤销采购关联（unlink-purchase）纠正采购收货，再处理库存。");
  }
  if (input.productionOrderId) {
    throw new StockInVoidRequestError("该入库单为生产退料，请通过生产工单变更审批纠正退料，不能直接作废。");
  }
  if (input.confirmedById === input.actorId) {
    throw new StockInVoidRequestError("入库确认人与作废人必须职责分离，不能作废本人确认的单据", 403);
  }
}

export function calculateInventoryAfterStockInVoid(input: {
  quantity: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  voidQuantity: Prisma.Decimal;
}) {
  const beforeQty = new Prisma.Decimal(input.quantity);
  const beforeAmount = new Prisma.Decimal(input.totalAmount);
  const voidQuantity = new Prisma.Decimal(input.voidQuantity);
  if (beforeQty.lte(0) || voidQuantity.lte(0) || beforeQty.lt(voidQuantity)) {
    throw new StockInVoidRequestError("当前库存不足，已有后续业务使用该入库物料，不能作废");
  }

  const afterQty = beforeQty.sub(voidQuantity).toDecimalPlaces(2);
  // 库存结果与既有出库一致：先以未提前舍入的移动平均成本计算，再交给 DECIMAL 列落库。
  // 仅审计列 reversalAmount 按其 DECIMAL(12,2) 精度保存，避免其舍入值反向影响库存平均价。
  const rawReversalAmount = afterQty.isZero()
    ? beforeAmount
    : Prisma.Decimal.min(beforeAmount.div(beforeQty).mul(voidQuantity), beforeAmount);
  const reversalAmount = rawReversalAmount.toDecimalPlaces(2);
  const afterAmount = Prisma.Decimal.max(beforeAmount.sub(rawReversalAmount), new Prisma.Decimal(0));
  const avgPrice = afterQty.gt(0) ? afterAmount.div(afterQty) : null;

  return { beforeQty, beforeAmount, voidQuantity, reversalAmount, afterQty, afterAmount, avgPrice };
}
