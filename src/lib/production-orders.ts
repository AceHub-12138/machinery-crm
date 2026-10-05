import { KitCheckStatus, Prisma, ProductionOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeOperationLog } from "@/lib/sales-items";
import { flattenBomLeafRequirements } from "@/lib/bom-items";
import { upsertPurchaseDemandForSource } from "@/lib/procurement-planning";

export class ProductionOrderRequestError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

export function isProductionOrderConcurrencyConflict(error: unknown) {
  const prismaError = error as { code?: string; meta?: { code?: string | number } } | null;
  return prismaError?.code === "P2002" ||
    prismaError?.code === "P2034" ||
    (prismaError?.code === "P2010" && String(prismaError.meta?.code) === "1213");
}

export type ProductionOrderDraftInput = {
  orderNo: string;
  contractId: string | null;
  contractItemId: string | null;
  productId: string;
  quantity: Prisma.Decimal;
  bomId: string;
  configuration: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  warehouseId: string | null;
  plannedDate: Date | null;
  responsibleId: string | null;
  remark: string | null;
};

type ExpandedMaterial = {
  materialId: string;
  materialCodeSnapshot: string;
  materialNameSnapshot: string;
  materialSpecSnapshot: string | null;
  unitSnapshot: string;
  perUnitQuantity: Prisma.Decimal;
  requiredQuantity: Prisma.Decimal;
  bomVersionSnapshot: string;
  sortOrder: number;
};

type ProductionOrderBuildOptions = {
  allowPlannedDateAfterDelivery?: boolean;
  allowContractProductChange?: boolean;
};

export const productionOrderStatusLabels: Record<ProductionOrderStatus, string> = {
  DRAFT: "草稿",
  ISSUED: "待齐套检查",
  CHANGE_PENDING: "变更待审批",
  CANCELLED: "已作废",
};

export function parsePositiveQuantity(value: unknown) {
  try {
    const quantity = new Prisma.Decimal(String(value ?? ""));
    return quantity.isFinite() && quantity.gt(0) ? quantity.toDecimalPlaces(2) : null;
  } catch {
    return null;
  }
}

/** 手工单据号统一去首尾空格，服务端才是必填判定的最终边界。 */
export function normalizeManualDocumentNo(value: unknown, label = "单据编号") {
  const normalized = String(value || "").trim();
  if (!normalized) throw new ProductionOrderRequestError(`${label}为必填项`);
  return normalized;
}

export function parseOptionalDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function normalizeProductionRequestKey(value: unknown) {
  const requestKey = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(requestKey)) {
    throw new ProductionOrderRequestError("生产工单请求缺少有效的幂等标识");
  }
  return requestKey;
}

export function normalizeDraftInput(body: Record<string, unknown>): ProductionOrderDraftInput {
  const orderNo = normalizeManualDocumentNo(body.orderNo, "工单编号");
  const quantity = parsePositiveQuantity(body.quantity);
  const plannedDate = parseOptionalDate(body.plannedDate);
  if (!quantity) throw new ProductionOrderRequestError("生产数量必须为大于 0 的有效数字");
  if (plannedDate === undefined) throw new ProductionOrderRequestError("计划完工日期格式无效");
  const productId = String(body.productId || "").trim();
  const bomId = String(body.bomId || "").trim();
  if (!orderNo || !productId || !bomId) {
    throw new ProductionOrderRequestError("工单编号、设备型号和生效的整机用料清单版本为必填项");
  }
  const specialRequirements = String(body.specialRequirements || "").trim();
  const configuration = specialRequirements
    ? { specialRequirements } satisfies Prisma.InputJsonObject
    : Prisma.JsonNull;
  return {
    orderNo,
    contractId: String(body.contractId || "").trim() || null,
    contractItemId: String(body.contractItemId || "").trim() || null,
    productId,
    quantity,
    bomId,
    configuration,
    warehouseId: String(body.warehouseId || "").trim() || null,
    plannedDate,
    responsibleId: String(body.responsibleId || "").trim() || null,
    remark: String(body.remark || "").trim() || null,
  };
}

export async function resolveDefaultWarehouse(tx: Prisma.TransactionClient) {
  const warehouse = await tx.warehouse.findFirst({ where: { name: "Dachuan", isActive: true } });
  if (!warehouse) throw new ProductionOrderRequestError("未找到名称为 Dachuan 的启用仓库，请在工单中手动选择其他仓库");
  return warehouse;
}

async function assertContractItemCapacity(
  tx: Prisma.TransactionClient,
  input: Pick<ProductionOrderDraftInput, "contractId" | "contractItemId" | "productId" | "quantity">,
  excludeOrderId?: string
) {
  if (!input.contractId && !input.contractItemId) return null;
  let contractItemId = input.contractItemId;
  if (input.contractId && !contractItemId && excludeOrderId) {
    const legacyCandidates = await tx.contractItem.findMany({
      where: { contractId: input.contractId, productId: input.productId },
      select: { id: true },
      take: 2,
    });
    if (legacyCandidates.length === 1) contractItemId = legacyCandidates[0].id;
  }
  if (!input.contractId || !contractItemId) {
    throw new ProductionOrderRequestError("合同工单必须同时选择合同和合同设备明细");
  }
  await tx.$queryRaw`SELECT id FROM contract_items WHERE id = ${contractItemId} FOR UPDATE`;
  const contractItem = await tx.contractItem.findFirst({
    where: { id: contractItemId, contractId: input.contractId },
    select: {
      id: true,
      productId: true,
      quantity: true,
      estimatedShipmentDate: true,
      contract: {
        select: {
          id: true,
          contractNo: true,
          contractStatus: true,
          deletedAt: true,
          estimatedShipmentDate: true,
          salesUser: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
  if (!contractItem) throw new ProductionOrderRequestError("合同设备明细不存在或不属于所选合同", 404);
  if (contractItem.contract.deletedAt || contractItem.contract.contractStatus !== "SIGNED") {
    throw new ProductionOrderRequestError("只能从有效且已签订的合同生成或发布生产工单", 409);
  }
  const sameProductItems = await tx.contractItem.findMany({
    where: { contractId: input.contractId, productId: contractItem.productId },
    select: { id: true },
    take: 2,
  });
  const canResolveLegacyOrders = sameProductItems.length === 1;
  if (!canResolveLegacyOrders) {
    const legacyOrder = await tx.productionOrder.findFirst({
      where: {
        contractId: input.contractId,
        contractItemId: null,
        productId: contractItem.productId,
        deletedAt: null,
        isCurrent: true,
        status: { not: "CANCELLED" },
        ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
      },
      select: { id: true },
    });
    if (legacyOrder) {
      throw new ProductionOrderRequestError(
        "该合同同一机型存在多条设备明细，且历史工单未关联具体合同明细；为避免超量，请先完成历史来源核对",
        409
      );
    }
  }
  const generated = await tx.productionOrder.findMany({
    where: {
      OR: [
        { contractItemId },
        ...(canResolveLegacyOrders
          ? [{ contractItemId: null, contractId: input.contractId, productId: contractItem.productId }]
          : []),
      ],
      deletedAt: null,
      isCurrent: true,
      status: { not: "CANCELLED" },
      ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
    },
    select: { quantity: true },
  });
  const remainingQuantity = calculateRemainingContractQuantity(
    contractItem.quantity,
    generated.map((order) => order.quantity)
  );
  if (remainingQuantity.lte(0)) {
    throw new ProductionOrderRequestError("该合同设备已全部生成生产工单", 409);
  }
  if (input.quantity.gt(remainingQuantity)) {
    throw new ProductionOrderRequestError(`生产数量超过合同明细剩余可生成数量 ${remainingQuantity.toString()}`, 409);
  }
  return { contractItem, remainingQuantity };
}

async function loadDraftReferences(
  tx: Prisma.TransactionClient,
  input: ProductionOrderDraftInput,
  excludeOrderId?: string,
  options?: ProductionOrderBuildOptions
) {
  const product = await tx.product.findFirst({
    where: { id: input.productId, isActive: true, productType: "MAIN" },
    include: { translations: { where: { language: "ZH" }, take: 1 } },
  });
  if (!product) throw new ProductionOrderRequestError("生产工单只能选择启用的主产品", 404);
  const bom = await tx.bomHeader.findFirst({
    where: { id: input.bomId, productId: input.productId, isActive: true },
    select: { id: true, version: true },
  });
  if (!bom) throw new ProductionOrderRequestError("该机型当前无生效用料清单，请先在整机用料清单模块设置生效版本");
  const warehouse = input.warehouseId
    ? await tx.warehouse.findFirst({ where: { id: input.warehouseId, isActive: true } })
    : await resolveDefaultWarehouse(tx);
  if (!warehouse) throw new ProductionOrderRequestError("仓库不存在或已停用", 404);
  if (input.responsibleId) {
    const responsible = await tx.user.findFirst({ where: { id: input.responsibleId, isActive: true }, select: { id: true } });
    if (!responsible) throw new ProductionOrderRequestError("负责人不存在或已停用", 400);
  }
  const contractSource = await assertContractItemCapacity(tx, input, excludeOrderId);
  if (contractSource && contractSource.contractItem.productId !== product.id && !options?.allowContractProductChange) {
    throw new ProductionOrderRequestError("生产机型必须与所选合同设备明细一致");
  }
  if (!options?.allowPlannedDateAfterDelivery) {
    assertPlannedCompletionDate(input.plannedDate, contractSource?.contractItem.estimatedShipmentDate || contractSource?.contractItem.contract.estimatedShipmentDate || null);
  }
  return { product, bom, warehouse, contractSource };
}

export async function buildDraftData(
  tx: Prisma.TransactionClient,
  input: ProductionOrderDraftInput,
  excludeOrderId?: string,
  options?: ProductionOrderBuildOptions
) {
  const { product, bom, warehouse, contractSource } = await loadDraftReferences(tx, input, excludeOrderId, options);
  const contract = contractSource?.contractItem.contract;
  return {
    orderNo: input.orderNo,
    contractId: contract?.id || null,
    contractItemId: contractSource?.contractItem.id || null,
    contractNoSnapshot: contract?.contractNo || null,
    isStockOrder: !contract,
    sequenceInContract: null,
    productId: product.id,
    productModelSnapshot: product.model,
    productNameSnapshot: product.translations[0]?.name || product.model,
    quantity: input.quantity,
    bomId: bom.id,
    bomVersionSnapshot: bom.version,
    configuration: input.configuration,
    warehouseId: warehouse.id,
    plannedDate: input.plannedDate,
    deliveryDateSnapshot: resolveDeliveryDateSnapshot({ contractItemDeliveryDate: contractSource?.contractItem.estimatedShipmentDate, contractHeaderDeliveryDate: contract?.estimatedShipmentDate, plannedDate: input.plannedDate }),
    responsibleId: input.responsibleId,
    remark: input.remark,
  };
}

export async function validateProductionOrderForIssue(tx: Prisma.TransactionClient, order: {
  id: string;
  contractId: string | null;
  contractItemId: string | null;
  isStockOrder: boolean;
  productId: string;
  quantity: Prisma.Decimal;
  bomId: string;
  warehouseId: string;
  plannedDate: Date | null;
}) {
  if (!order.productId || !order.bomId || !order.warehouseId || !order.quantity.gt(0)) {
    throw new ProductionOrderRequestError("发布前必须确定设备型号、生产数量、整机用料清单版本和生产仓库");
  }
  if (!order.plannedDate) throw new ProductionOrderRequestError("发布前必须填写计划完工日期");
  if (!order.isStockOrder) {
    const source = await assertContractItemCapacity(tx, order, order.id);
    assertPlannedCompletionDate(order.plannedDate, source?.contractItem.estimatedShipmentDate || source?.contractItem.contract.estimatedShipmentDate || null);
  }
}

export async function nextSequenceInContract(tx: Prisma.TransactionClient, contractId: string) {
  const last = await tx.productionOrder.findFirst({
    where: { contractId, deletedAt: null, isCurrent: true },
    orderBy: { sequenceInContract: "desc" },
    select: { sequenceInContract: true },
  });
  return (last?.sequenceInContract || 0) + 1;
}

export async function nextStockOrderNo(tx: Prisma.TransactionClient) {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `MO${dateStr}-`;
  const last = await tx.productionOrder.findFirst({ where: { orderNo: { startsWith: prefix } }, orderBy: { orderNo: "desc" }, select: { orderNo: true } });
  const lastSeq = last ? parseInt(last.orderNo.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(3, "0")}`;
}

export function issuedOrderNo(contractNo: string | null, sequence: number | null, stockOrderNo: string) {
  return contractNo && sequence ? `${contractNo}-${String(sequence).padStart(2, "0")}` : stockOrderNo;
}

export function calculateKitMaterialQuantities(plannedQuantity: Prisma.Decimal.Value, issuedQuantity: Prisma.Decimal.Value, returnedQuantity: Prisma.Decimal.Value, inventoryQuantity: Prisma.Decimal.Value) {
  const netIssuedQty = Prisma.Decimal.max(new Prisma.Decimal(issuedQuantity).sub(returnedQuantity), new Prisma.Decimal(0));
  const remainingQty = Prisma.Decimal.max(new Prisma.Decimal(plannedQuantity).sub(netIssuedQty), new Prisma.Decimal(0));
  const shortageQty = Prisma.Decimal.max(remainingQty.sub(inventoryQuantity), new Prisma.Decimal(0));
  return { netIssuedQty, remainingQty, shortageQty };
}

export function shortageDemandItems(detail: unknown) {
  if (!Array.isArray(detail)) return [];
  return detail.flatMap((raw) => {
    const item = (raw || {}) as Record<string, unknown>;
    const materialId = String(item.materialId || "").trim();
    const shortageQty = Number(item.shortageQty || 0);
    const newDemand = Number(item.remainingRequiredQty ?? item.requiredQty ?? 0);
    return materialId && Number.isFinite(shortageQty) && shortageQty > 0 && Number.isFinite(newDemand) && newDemand > 0
      ? [{ materialId, newDemand }]
      : [];
  });
}

export function calculateRemainingContractQuantity(
  contractQuantity: Prisma.Decimal.Value,
  generatedQuantities: Prisma.Decimal.Value[]
) {
  const generated = generatedQuantities.reduce<Prisma.Decimal>(
    (total, quantity) => total.add(quantity),
    new Prisma.Decimal(0)
  );
  return Prisma.Decimal.max(new Prisma.Decimal(contractQuantity).sub(generated), new Prisma.Decimal(0));
}

export function assertPlannedCompletionDate(plannedDate: Date | null, contractDeliveryDate: Date | null) {
  if (!plannedDate || !contractDeliveryDate) return;
  const plannedDay = plannedDate.toISOString().slice(0, 10);
  const deliveryDay = contractDeliveryDate.toISOString().slice(0, 10);
  if (plannedDay > deliveryDay) {
    throw new ProductionOrderRequestError("计划完工日期不得晚于合同交货日期；延期请在工单发布后走变更审批");
  }
}

export function resolveDeliveryDateSnapshot(input: { contractItemDeliveryDate?: Date | null; contractHeaderDeliveryDate?: Date | null; plannedDate: Date | null }) {
  return input.contractItemDeliveryDate || input.contractHeaderDeliveryDate || input.plannedDate;
}

export async function expandBomSnapshot(
  tx: Prisma.TransactionClient,
  input: { bomId: string; productId: string; quantity: Prisma.Decimal }
): Promise<{ bomVersion: string; materials: ExpandedMaterial[] }> {
  const bom = await tx.bomHeader.findFirst({
    where: { id: input.bomId, productId: input.productId, isActive: true },
    include: { items: { include: { material: { select: { id: true, code: true, name: true, spec: true, unit: true, isActive: true, deletedAt: true } } }, orderBy: { sortOrder: "asc" } } },
  });
  if (!bom) throw new ProductionOrderRequestError("该产品当前无生效用料清单，请先在整机用料清单模块设置生效版本");
  if (bom.items.some((item) => !item.material.isActive || item.material.deletedAt)) {
    throw new ProductionOrderRequestError("整机用料清单中存在已停用或已删除的物料，请先修正用料清单");
  }
  let leaves;
  try {
    leaves = flattenBomLeafRequirements(bom.items, input.quantity);
  } catch (error) {
    throw new ProductionOrderRequestError(error instanceof Error ? error.message : "整机用料清单层级无效");
  }
  if (leaves.length === 0) throw new ProductionOrderRequestError("整机用料清单没有可展开的叶子物料，无法下达工单");
  const itemById = new Map(bom.items.map((item) => [item.id, item]));
  return {
    bomVersion: bom.version,
    materials: leaves.map((leaf, sortOrder) => {
      const item = itemById.get(leaf.sourceItemId)!;
      return {
        materialId: item.materialId,
        materialCodeSnapshot: item.material.code,
        materialNameSnapshot: item.material.name,
        materialSpecSnapshot: item.material.spec,
        unitSnapshot: item.material.unit,
        perUnitQuantity: leaf.perUnitQuantity.toDecimalPlaces(4),
        requiredQuantity: leaf.requiredQuantity.toDecimalPlaces(4),
        bomVersionSnapshot: bom.version,
        sortOrder,
      };
    }),
  };
}

export async function createKitCheckResult(tx: Prisma.TransactionClient, input: { productionOrderId: string; checkedById: string; triggerKey?: string; triggerType?: string }) {
  const order = await tx.productionOrder.findFirst({ where: { id: input.productionOrderId, deletedAt: null }, select: { id: true, orderNo: true, warehouseId: true, status: true, quantity: true, plannedDate: true, bomVersionSnapshot: true } });
  if (!order) throw new ProductionOrderRequestError("生产工单不存在", 404);
  if (order.status !== "ISSUED") throw new ProductionOrderRequestError("只有已发布且未作废的生产工单可以执行齐套检查", 409);
  const materials = await tx.productionOrderMaterial.findMany({ where: { productionOrderId: order.id }, orderBy: { sortOrder: "asc" } });
  if (materials.length === 0) throw new ProductionOrderRequestError("生产工单缺少物料快照，无法执行齐套检查", 409);
  const materialIds = materials.map((item) => item.materialId);
  const [inventories, openPurchaseOrders, issuedDocuments, returnedDocuments] = await Promise.all([
    tx.inventory.findMany({ where: { warehouseId: order.warehouseId, materialId: { in: materialIds } }, select: { materialId: true, quantity: true } }),
    tx.purchaseOrder.findMany({ where: { deletedAt: null, status: { in: ["ORDERED", "PARTIAL_RECEIVED"] } }, select: { id: true } }),
    tx.stockOut.findMany({ where: { productionOrderId: order.id }, include: { items: true } }),
    tx.stockIn.findMany({ where: { productionOrderId: order.id, status: "CONFIRMED" }, include: { items: true } }),
  ]);
  const purchaseItems = openPurchaseOrders.length
    ? await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: { in: openPurchaseOrders.map((item) => item.id) }, materialId: { in: materialIds } }, select: { materialId: true, quantity: true, receivedQuantity: true } })
    : [];
  const availableByMaterial = new Map(inventories.map((item) => [item.materialId, new Prisma.Decimal(item.quantity)]));
  const inTransitByMaterial = new Map<string, Prisma.Decimal>();
  for (const item of purchaseItems) {
    const inTransit = new Prisma.Decimal(item.quantity).sub(item.receivedQuantity);
    inTransitByMaterial.set(item.materialId, (inTransitByMaterial.get(item.materialId) || new Prisma.Decimal(0)).add(inTransit));
  }
  const issuedByMaterial = new Map<string, Prisma.Decimal>();
  const returnedByMaterial = new Map<string, Prisma.Decimal>();
  for (const document of issuedDocuments) for (const item of document.items) issuedByMaterial.set(item.materialId, (issuedByMaterial.get(item.materialId) || new Prisma.Decimal(0)).add(item.quantity));
  for (const document of returnedDocuments) for (const item of document.items) returnedByMaterial.set(item.materialId, (returnedByMaterial.get(item.materialId) || new Prisma.Decimal(0)).add(item.quantity));
  const detail = materials.map((item) => {
    const quantities = calculateKitMaterialQuantities(item.requiredQuantity, issuedByMaterial.get(item.materialId) || new Prisma.Decimal(0), returnedByMaterial.get(item.materialId) || new Prisma.Decimal(0), availableByMaterial.get(item.materialId) || new Prisma.Decimal(0));
    const requiredQty = quantities.remainingQty;
    const availableQty = availableByMaterial.get(item.materialId) || new Prisma.Decimal(0);
    const shortageQty = quantities.shortageQty;
    return {
      materialId: item.materialId, code: item.materialCodeSnapshot, name: item.materialNameSnapshot, spec: item.materialSpecSnapshot, unit: item.unitSnapshot,
      perUnitQty: Number(item.perUnitQuantity), orderQty: Number(order.quantity), totalRequiredQty: Number(item.requiredQuantity),
      requiredQty: requiredQty.toNumber(), remainingRequiredQty: requiredQty.toNumber(), availableQty: availableQty.toNumber(), shortageQty: shortageQty.toNumber(),
      inTransitQty: (inTransitByMaterial.get(item.materialId) || new Prisma.Decimal(0)).toNumber(),
    };
  });
  const shortageCount = detail.filter((item) => item.shortageQty > 0).length;
  const result = await tx.kitCheckResult.create({
    data: { productionOrderId: order.id, warehouseId: order.warehouseId, bomVersionSnapshot: order.bomVersionSnapshot, status: shortageCount ? KitCheckStatus.SHORTAGE : KitCheckStatus.SUFFICIENT, shortageCount, totalMaterials: detail.length, detail, checkedById: input.checkedById, triggerKey: input.triggerKey || null, triggerType: input.triggerType || "MANUAL" },
  });
  await tx.productionOrder.update({
    where: { id: order.id },
    data: { kitCheckStatus: result.status, kitCheckRequired: false, latestKitCheckId: result.id, lastKitCheckedAt: result.createdAt },
  });
  await writeOperationLog(tx, { userId: input.checkedById, action: "CHECK_PRODUCTION_ORDER_KIT", entityType: "ProductionOrder", entityId: order.id, afterData: { result } });
  return result;
}

export async function createPurchaseDemandsForKitCheck(tx: Prisma.TransactionClient, input: { productionOrderId: string; kitCheckId: string; createdById: string }) {
  const order = await tx.productionOrder.findFirst({
    where: { id: input.productionOrderId, deletedAt: null, isCurrent: true, status: "ISSUED" },
    select: { id: true, orderNo: true, plannedDate: true, latestKitCheckId: true },
  });
  if (!order) throw new ProductionOrderRequestError("生产工单不存在或当前状态不能生成采购需求", 409);
  if (order.latestKitCheckId !== input.kitCheckId) throw new ProductionOrderRequestError("齐套检查结果已更新，请刷新后按最新结果生成采购需求", 409);
  const check = await tx.kitCheckResult.findFirst({ where: { id: input.kitCheckId, productionOrderId: order.id, status: "SHORTAGE", deletedAt: null }, select: { id: true, detail: true } });
  if (!check) throw new ProductionOrderRequestError("未找到有效的缺料检查结果", 404);
  const candidates = shortageDemandItems(check.detail);
  if (candidates.length === 0) throw new ProductionOrderRequestError("当前齐套检查没有需要采购的缺料", 409);

  const created = [];
  const skipped = [];
  for (const item of candidates) {
    const demand = await upsertPurchaseDemandForSource(tx, {
      sourceType: "PRODUCTION_ORDER",
      sourceRecordId: order.id,
      sourceLineId: check.id,
      sourceLabel: `生产工单 ${order.orderNo}`,
      materialId: item.materialId,
      newDemand: item.newDemand,
      needByDate: order.plannedDate || new Date(),
      createdById: input.createdById,
      excludeProductionOrderId: order.id,
    });
    if (demand) created.push(demand);
    else skipped.push({ materialId: item.materialId, reason: "库存、在途或已有采购需求已覆盖" });
  }
  await writeOperationLog(tx, { userId: input.createdById, action: "CREATE_PRODUCTION_ORDER_PURCHASE_DEMANDS", entityType: "ProductionOrder", entityId: order.id, afterData: { kitCheckId: check.id, demandIds: created.map((item) => item.id), skipped } });
  return { created, skipped };
}

export async function getProductionOrderDetail(id: string) {
  const order = await prisma.productionOrder.findFirst({ where: { id, deletedAt: null }, include: { materials: { orderBy: { sortOrder: "asc" } }, kitCheckResults: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } }, changeRequests: { orderBy: { createdAt: "desc" } } } });
  if (!order) return null;
  const versionHistory: Array<{ id: string; orderNo: string; version: number; status: ProductionOrderStatus; isCurrent: boolean; createdAt: Date }> = [{ id: order.id, orderNo: order.orderNo, version: order.version, status: order.status, isCurrent: order.isCurrent, createdAt: order.createdAt }];
  let predecessorId = order.supersedesId;
  while (predecessorId) {
    const predecessor = await prisma.productionOrder.findUnique({ where: { id: predecessorId }, select: { id: true, orderNo: true, version: true, status: true, isCurrent: true, createdAt: true, supersedesId: true } });
    if (!predecessor) break;
    versionHistory.unshift({ id: predecessor.id, orderNo: predecessor.orderNo, version: predecessor.version, status: predecessor.status, isCurrent: predecessor.isCurrent, createdAt: predecessor.createdAt });
    predecessorId = predecessor.supersedesId;
  }
  let successorId = versionHistory[versionHistory.length - 1].id;
  while (successorId) {
    const successor = await prisma.productionOrder.findUnique({ where: { supersedesId: successorId }, select: { id: true, orderNo: true, version: true, status: true, isCurrent: true, createdAt: true } });
    if (!successor) break;
    versionHistory.push(successor);
    successorId = successor.id;
  }
  const [contract, product, bom, warehouse, stockOuts, stockIns, inventories, productionResponsible] = await Promise.all([
    order.contractId ? prisma.contract.findFirst({ where: { id: order.contractId, deletedAt: null }, select: { id: true, contractNo: true, estimatedShipmentDate: true, salesUser: { select: { id: true, name: true, email: true } } } }) : null,
    prisma.product.findUnique({ where: { id: order.productId }, select: { id: true, model: true } }),
    prisma.bomHeader.findUnique({ where: { id: order.bomId }, select: { id: true, version: true, isActive: true } }),
    prisma.warehouse.findUnique({ where: { id: order.warehouseId }, select: { id: true, name: true, code: true, isActive: true } }),
    prisma.stockOut.findMany({ where: { productionOrderId: order.id }, include: { items: true }, orderBy: { createdAt: "desc" } }),
    prisma.stockIn.findMany({ where: { productionOrderId: order.id, status: "CONFIRMED" }, include: { items: true }, orderBy: { createdAt: "desc" } }),
    prisma.inventory.findMany({ where: { warehouseId: order.warehouseId, materialId: { in: order.materials.map((item) => item.materialId) } }, select: { materialId: true, quantity: true } }),
    order.responsibleId ? prisma.user.findUnique({ where: { id: order.responsibleId }, select: { id: true, name: true, email: true } }) : null,
  ]);
  const issuedByMaterial = new Map<string, Prisma.Decimal>();
  const returnedByMaterial = new Map<string, Prisma.Decimal>();
  for (const document of stockOuts) for (const item of document.items) issuedByMaterial.set(item.materialId, (issuedByMaterial.get(item.materialId) || new Prisma.Decimal(0)).add(item.quantity));
  for (const document of stockIns) for (const item of document.items) returnedByMaterial.set(item.materialId, (returnedByMaterial.get(item.materialId) || new Prisma.Decimal(0)).add(item.quantity));
  const inventoryByMaterial = new Map(inventories.map((item) => [item.materialId, new Prisma.Decimal(item.quantity)]));
  const materialSummary = order.materials.map((item) => {
    const issuedQty = issuedByMaterial.get(item.materialId) || new Prisma.Decimal(0);
    const returnedQty = returnedByMaterial.get(item.materialId) || new Prisma.Decimal(0);
    const netIssuedQty = Prisma.Decimal.max(issuedQty.sub(returnedQty), new Prisma.Decimal(0));
    const remainingQty = Prisma.Decimal.max(new Prisma.Decimal(item.requiredQuantity).sub(netIssuedQty), new Prisma.Decimal(0));
    return { materialId: item.materialId, plannedQty: Number(item.requiredQuantity), issuedQty: issuedQty.toNumber(), returnedQty: returnedQty.toNumber(), netIssuedQty: netIssuedQty.toNumber(), remainingQty: remainingQty.toNumber(), inventoryQty: (inventoryByMaterial.get(item.materialId) || new Prisma.Decimal(0)).toNumber() };
  });
  return { ...order, contract, contractMeta: contract ? { ...contract, estimatedShipmentDate: order.deliveryDateSnapshot || contract.estimatedShipmentDate } : null, productionResponsible, product, bom, warehouse, stockOuts, stockIns, materialSummary, versionHistory, latestKitCheckResult: order.kitCheckResults[0] || null };
}

export async function getProductionOrderProcurementView(id: string) {
  const order = await prisma.productionOrder.findFirst({
    where: { id, deletedAt: null, isCurrent: true },
    select: {
      id: true,
      orderNo: true,
      productModelSnapshot: true,
      productNameSnapshot: true,
      quantity: true,
      plannedDate: true,
      bomId: true,
      warehouseId: true,
      status: true,
      kitCheckResults: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, shortageCount: true, detail: true, createdAt: true } },
    },
  });
  if (!order) return null;
  const latestKitCheckResult = order.kitCheckResults[0] || null;
  return {
    id: order.id,
    orderNo: order.orderNo,
    productModelSnapshot: order.productModelSnapshot,
    productNameSnapshot: order.productNameSnapshot,
    quantity: order.quantity,
    plannedDate: order.plannedDate,
    bomId: order.bomId,
    warehouseId: order.warehouseId,
    status: order.status,
    latestKitCheckResult,
    shortageItems: latestKitCheckResult?.status === "SHORTAGE"
      ? (latestKitCheckResult.detail as any[]).filter((item) => Number(item.shortageQty) > 0).map((item) => ({ materialId: item.materialId, code: item.code, name: item.name, spec: item.spec || null, unit: item.unit, shortageQty: item.shortageQty }))
      : [],
  };
}
