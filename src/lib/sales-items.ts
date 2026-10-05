import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/permissions";

export type LineItemInput = {
  productId: string;
  itemType: "MAIN" | "OPTIONAL";
  quotedPrice?: string | number | null;
  contractPrice?: string | number | null;
  quantity?: string | number | null;
  sortOrder?: number;
  estimatedShipmentDate?: string | Date | null;
};

export function toNumber(value: unknown, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

export function getProductName(product: any) {
  return product?.translations?.[0]?.name || product?.model || product?.category || "";
}

export function itemAmount(item: { quotedPrice?: unknown; contractPrice?: unknown; quantity?: unknown }) {
  const price = toNumber(item.quotedPrice ?? item.contractPrice, 0);
  const quantity = Math.max(1, Math.trunc(toNumber(item.quantity, 1)));
  return price * quantity;
}

export function sumItems(items: Array<{ quotedPrice?: unknown; contractPrice?: unknown; quantity?: unknown }>) {
  return items.reduce((sum, item) => sum + itemAmount(item), 0);
}

export function paymentStatusFor(amount: number, paidAmount: number): "UNPAID" | "PARTIAL_PAID" | "PAID" {
  if (paidAmount <= 0) return "UNPAID";
  if (paidAmount >= amount) return "PAID";
  return "PARTIAL_PAID";
}

export function assertAmountCoversPaid(amount: number, paidAmount: number) {
  if (amount < paidAmount) {
    throw new Error("新合同金额低于当前已收款金额，无法自动更新。请在第二阶段回款修改功能上线后处理回款记录，或通过特殊审批处理。");
  }
}

export function isContractLocked(contract: { contractStatus?: string; shipments?: Array<{ shipmentStatus?: string }> }) {
  if (contract.contractStatus === "COMPLETED" || contract.contractStatus === "ARCHIVED" || contract.contractStatus === "CANCELLED") {
    return true;
  }
  return contract.shipments?.some((shipment) => shipment.shipmentStatus === "SHIPPED" || shipment.shipmentStatus === "PARTIAL_SHIPPED") || false;
}

export function lockedContractMessage() {
  return "当前合同已锁定，如需修改，请联系超级管理员审批。";
}

export function hasActiveUnlock(contract: { editUnlockedUntil?: Date | string | null }) {
  if (!contract.editUnlockedUntil) return false;
  return new Date(contract.editUnlockedUntil).getTime() > Date.now();
}

export function canEditContract(
  user: SessionUser,
  contract: { contractStatus?: string; shipments?: Array<{ shipmentStatus?: string }>; editUnlockedUntil?: Date | string | null }
) {
  if (!isContractLocked(contract)) return true;
  if (user.role === "SUPER_ADMIN") return true;
  return hasActiveUnlock(contract);
}

export function toPlainJson(value: unknown) {
  return JSON.parse(JSON.stringify(value, (_key, current) => {
    if (typeof current === "bigint") return current.toString();
    return current;
  }));
}

export async function writeOperationLog(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    action: string;
    entityType: string;
    entityId: string;
    beforeData?: unknown;
    afterData?: unknown;
  }
) {
  await tx.operationLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeData: input.beforeData === undefined ? undefined : toPlainJson(input.beforeData),
      afterData: input.afterData === undefined ? undefined : toPlainJson(input.afterData),
    },
  });
}

export async function recalculateContractPayments(tx: Prisma.TransactionClient, contractId: string) {
  const contract = await tx.contract.findUnique({ where: { id: contractId } });
  if (!contract) throw new Error("合同不存在");

  const payments = await tx.contractPayment.findMany({
    where: { contractId, status: "ACTIVE" },
  });
  const paidAmount = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const amount = Number(contract.amount);
  if (paidAmount > amount) {
    throw new Error("同一合同累计回款不能超过合同总金额");
  }

  const unpaidAmount = amount - paidAmount;
  const paymentStatus = paymentStatusFor(amount, paidAmount);

  await tx.contract.update({
    where: { id: contractId },
    data: { paidAmount, unpaidAmount, paymentStatus },
  });

  return { paidAmount, unpaidAmount, paymentStatus };
}

export function buildItemData(product: any, input: LineItemInput, priceField: "quotedPrice" | "contractPrice", index: number) {
  const rawQuantity = input.quantity === null || input.quantity === undefined || input.quantity === "" ? 1 : Number(input.quantity);
  const rawPrice = input[priceField] === null || input[priceField] === undefined || input[priceField] === "" ? 0 : Number(input[priceField]);
  if (!Number.isFinite(rawQuantity) || Math.trunc(rawQuantity) < 1) throw new Error("产品数量必须为大于 0 的整数");
  if (!Number.isFinite(rawPrice) || rawPrice < 0) throw new Error("产品价格必须为大于等于 0 的数字");
  const quantity = Math.trunc(rawQuantity);
  const price = rawPrice;
  return {
    productId: product.id,
    itemType: input.itemType,
    productNameSnapshot: getProductName(product),
    productModelSnapshot: product.model,
    factoryPriceSnapshot: product.factoryPrice === null || product.factoryPrice === undefined ? null : Number(product.factoryPrice),
    [priceField]: price,
    quantity,
    sortOrder: input.sortOrder ?? index,
    estimatedShipmentDate: input.estimatedShipmentDate ? new Date(input.estimatedShipmentDate) : null,
  };
}

export async function buildItemsFromInputs(
  tx: Prisma.TransactionClient,
  rawItems: LineItemInput[],
  priceField: "quotedPrice" | "contractPrice"
) {
  const items = rawItems
    .filter((item) => item.productId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const mainItems = items.filter((item) => item.itemType === "MAIN");
  if (mainItems.length < 1) {
    throw new Error("至少需要选择一个主产品");
  }

  const products = await tx.product.findMany({
    where: { id: { in: Array.from(new Set(items.map((item) => item.productId))) }, isActive: true },
    include: { translations: { where: { language: "ZH" } } },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  return items.map((item, index) => {
    const product = productById.get(item.productId);
    if (!product) throw new Error("产品不存在或已停用");
    if (item.itemType === "MAIN" && product.productType !== "MAIN") {
      throw new Error("主产品必须选择主产品类型");
    }
    if (item.itemType === "OPTIONAL" && product.productType !== "OPTIONAL") {
      throw new Error("选配产品必须选择选配产品类型");
    }
    return buildItemData(product, item, priceField, index);
  });
}
