import { randomUUID } from "crypto";
import { Prisma, ProcurementSourceType } from "@prisma/client";

const ACTIVE_DEMAND_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_CONVERTED"] as const;

export function calculateSuggestedProcurement(input: {
  newDemand: Prisma.Decimal.Value;
  safetyStockTarget: Prisma.Decimal.Value;
  inventory: Prisma.Decimal.Value;
  confirmedInbound: Prisma.Decimal.Value;
  reservedNotIssued: Prisma.Decimal.Value;
  existingEffectiveDemand: Prisma.Decimal.Value;
}) {
  const expectedAvailable = new Prisma.Decimal(input.inventory)
    .add(input.confirmedInbound)
    .sub(input.reservedNotIssued);
  const suggestedQuantity = Prisma.Decimal.max(
    new Prisma.Decimal(input.newDemand)
      .add(input.safetyStockTarget)
      .sub(expectedAvailable)
      .sub(input.existingEffectiveDemand),
    new Prisma.Decimal(0)
  ).toDecimalPlaces(4);
  return { expectedAvailable: expectedAvailable.toDecimalPlaces(4), suggestedQuantity };
}

export function reconcileDemandSuggestion(
  remainingSuggestion: Prisma.Decimal.Value,
  convertedQuantity: Prisma.Decimal.Value
) {
  const remaining = Prisma.Decimal.max(new Prisma.Decimal(remainingSuggestion), 0);
  const converted = Prisma.Decimal.max(new Prisma.Decimal(convertedQuantity), 0);
  return {
    suggestedQuantity: remaining.add(converted).toDecimalPlaces(4),
    shouldClose: remaining.lte(0) && converted.gt(0),
  };
}

export async function buildMaterialProcurementSnapshot(
  tx: Prisma.TransactionClient,
  input: { materialId: string; newDemand: Prisma.Decimal.Value; excludeProductionOrderId?: string; excludePurchaseDemandId?: string }
) {
  const material = await tx.material.findFirst({
    where: { id: input.materialId, isActive: true, deletedAt: null },
    select: { id: true, safetyStock: true, safetyStockEnabled: true, autoPurchaseDraftEnabled: true },
  });
  if (!material) throw new Error("物料不存在或已停用");
  const openOrders = await tx.purchaseOrder.findMany({ where: { deletedAt: null, status: { in: ["ORDERED", "PARTIAL_RECEIVED"] } }, select: { id: true } });
  const draftOrders = await tx.purchaseOrder.findMany({ where: { deletedAt: null, status: "DRAFT" }, select: { id: true } });
  const draftItems = draftOrders.length ? await tx.purchaseOrderItem.findMany({ where: { materialId: input.materialId, purchaseOrderId: { in: draftOrders.map((order) => order.id) } }, select: { id: true } }) : [];
  const [inventories, purchaseItems, activeDemands, draftAllocations, productionMaterials] = await Promise.all([
    tx.inventory.findMany({ where: { materialId: input.materialId }, select: { quantity: true } }),
    tx.purchaseOrderItem.findMany({
      where: { materialId: input.materialId, purchaseOrderId: { in: openOrders.map((order) => order.id) } },
      select: { quantity: true, receivedQuantity: true },
    }),
    tx.purchaseDemand.findMany({
      where: { materialId: input.materialId, activeSlot: true, status: { in: [...ACTIVE_DEMAND_STATUSES] }, ...(input.excludePurchaseDemandId ? { id: { not: input.excludePurchaseDemandId } } : {}) },
      select: { suggestedQuantity: true, convertedQuantity: true },
    }),
    tx.purchaseOrderItemSource.findMany({ where: { purchaseOrderItemId: { in: draftItems.map((item) => item.id) } }, select: { allocatedQuantity: true, fulfilledQuantity: true } }),
    tx.productionOrderMaterial.findMany({
      where: {
        materialId: input.materialId,
        productionOrder: {
          deletedAt: null,
          isCurrent: true,
          status: { in: ["ISSUED", "CHANGE_PENDING"] },
          ...(input.excludeProductionOrderId ? { id: { not: input.excludeProductionOrderId } } : {}),
        },
      },
      select: { requiredQuantity: true, productionOrderId: true },
    }),
  ]);
  const orderIds = [...new Set(productionMaterials.map((row) => row.productionOrderId))];
  const [issues, returns] = orderIds.length ? await Promise.all([
    tx.stockOutItem.findMany({ where: { materialId: input.materialId, stockOut: { productionOrderId: { in: orderIds } } }, select: { quantity: true } }),
    tx.stockInItem.findMany({ where: { materialId: input.materialId, stockIn: { productionOrderId: { in: orderIds }, status: "CONFIRMED" } }, select: { quantity: true } }),
  ]) : [[], []];
  const sum = (values: Prisma.Decimal.Value[]) => values.reduce<Prisma.Decimal>((total, value) => total.add(value), new Prisma.Decimal(0));
  const maxZero = (value: Prisma.Decimal.Value) => { const decimal = new Prisma.Decimal(value); return decimal.gt(0) ? decimal : new Prisma.Decimal(0); };
  const inventory = sum(inventories.map((row) => row.quantity));
  const confirmedInbound = sum(purchaseItems.map((row) => maxZero(new Prisma.Decimal(row.quantity).sub(row.receivedQuantity))));
  const totalRequired = sum(productionMaterials.map((row) => row.requiredQuantity));
  const netIssued = maxZero(sum(issues.map((row) => row.quantity)).sub(sum(returns.map((row) => row.quantity))));
  const reservedNotIssued = maxZero(totalRequired.sub(netIssued));
  const existingEffectiveDemand = sum([
    ...activeDemands.map((row) => maxZero(new Prisma.Decimal(row.suggestedQuantity).sub(row.convertedQuantity))),
    ...draftAllocations.map((row) => maxZero(new Prisma.Decimal(row.allocatedQuantity).sub(row.fulfilledQuantity))),
  ]);
  const safetyStockTarget = material.safetyStockEnabled ? new Prisma.Decimal(material.safetyStock || 0) : new Prisma.Decimal(0);
  const result = calculateSuggestedProcurement({
    newDemand: input.newDemand,
    safetyStockTarget,
    inventory,
    confirmedInbound,
    reservedNotIssued,
    existingEffectiveDemand,
  });
  return {
    material,
    ...result,
    snapshot: {
      newDemand: Number(input.newDemand),
      safetyStockTarget: safetyStockTarget.toNumber(),
      inventory: inventory.toNumber(),
      confirmedInbound: confirmedInbound.toNumber(),
      reservedNotIssued: reservedNotIssued.toNumber(),
      existingEffectiveDemand: existingEffectiveDemand.toNumber(),
      expectedAvailable: result.expectedAvailable.toNumber(),
      suggestedQuantity: result.suggestedQuantity.toNumber(),
      formulaVersion: "2026-07-phase4-v1",
    } satisfies Prisma.InputJsonObject,
  };
}

export async function upsertPurchaseDemandForSource(tx: Prisma.TransactionClient, input: {
  sourceType: ProcurementSourceType;
  sourceRecordId: string;
  sourceLineId?: string | null;
  sourceLabel: string;
  materialId: string;
  newDemand: Prisma.Decimal.Value;
  needByDate: Date;
  createdById: string;
  excludeProductionOrderId?: string;
  stockPurpose?: string | null;
  replenishmentReason?: string | null;
  targetStockQuantity?: Prisma.Decimal.Value | null;
  forceCreate?: boolean;
}) {
  const existing = await tx.purchaseDemand.findFirst({
    where: { sourceType: input.sourceType, sourceRecordId: input.sourceRecordId, materialId: input.materialId, activeSlot: true },
  });
  const calculation = await buildMaterialProcurementSnapshot(tx, { ...input, excludePurchaseDemandId: existing?.id });
  const reconciliation = existing
    ? reconcileDemandSuggestion(calculation.suggestedQuantity, existing.convertedQuantity)
    : null;
  if (calculation.suggestedQuantity.lte(0) || (!calculation.material.autoPurchaseDraftEnabled && !input.forceCreate)) {
    if (existing && existing.status === "DRAFT") {
      await tx.purchaseDemand.update({ where: { id: existing.id }, data: { status: "CANCELLED", activeSlot: null, cancelledAt: new Date(), calculationSnapshot: calculation.snapshot } });
    } else if (existing && existing.status === "PARTIALLY_CONVERTED" && reconciliation?.shouldClose) {
      await tx.purchaseDemand.update({
        where: { id: existing.id },
        data: {
          suggestedQuantity: reconciliation.suggestedQuantity,
          status: "CONVERTED",
          activeSlot: null,
          calculationSnapshot: {
            ...calculation.snapshot,
            remainingSuggestedQuantity: 0,
            suggestedQuantity: reconciliation.suggestedQuantity.toNumber(),
          },
        },
      });
    }
    return null;
  }
  const suggestedQuantity = reconciliation
    ? reconciliation.suggestedQuantity
    : calculation.suggestedQuantity;
  const calculationSnapshot = {
    ...calculation.snapshot,
    remainingSuggestedQuantity: calculation.suggestedQuantity.toNumber(),
    suggestedQuantity: suggestedQuantity.toNumber(),
  } satisfies Prisma.InputJsonObject;
  const data = {
    sourceLineId: input.sourceLineId || null,
    sourceLabel: input.sourceLabel,
    requestedQuantity: new Prisma.Decimal(input.newDemand).toDecimalPlaces(4),
    suggestedQuantity,
    targetStockQuantity: input.targetStockQuantity === null || input.targetStockQuantity === undefined ? null : new Prisma.Decimal(input.targetStockQuantity).toDecimalPlaces(4),
    needByDate: input.needByDate,
    stockPurpose: input.stockPurpose || null,
    replenishmentReason: input.replenishmentReason || null,
    calculationSnapshot,
  };
  if (existing) return tx.purchaseDemand.update({ where: { id: existing.id }, data });
  return tx.purchaseDemand.create({
    data: {
      demandNo: `PR-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
      sourceType: input.sourceType,
      sourceRecordId: input.sourceRecordId,
      materialId: input.materialId,
      activeSlot: true,
      createdById: input.createdById,
      ...data,
    },
  });
}
