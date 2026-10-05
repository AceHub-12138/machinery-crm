import { Prisma } from "@prisma/client";

export const INTEGER_BOM_UNITS = new Set(["件", "个", "台", "套", "包", "组", "根"]);

export type BomTreeItem = {
  id: string;
  parentItemId: string | null;
  materialId: string;
  quantity: Prisma.Decimal.Value;
  sortOrder: number;
};

export type BomLeafRequirement = {
  materialId: string;
  sourceItemId: string;
  perUnitQuantity: Prisma.Decimal;
  requiredQuantity: Prisma.Decimal;
  sortOrder: number;
};

export type BomWriteItem = {
  clientKey: string;
  parentClientKey: string | null;
  materialId: string;
  quantity: Prisma.Decimal;
  level: number;
  sortOrder: number;
};

export function parseBomQuantity(value: unknown, unit: string): Prisma.Decimal | null {
  try {
    const quantity = new Prisma.Decimal(String(value ?? ""));
    if (!quantity.isFinite() || !quantity.gt(0)) return null;
    if (INTEGER_BOM_UNITS.has(unit.trim()) && !quantity.isInteger()) return null;
    const storedQuantity = quantity.toDecimalPlaces(2);
    return storedQuantity.gt(0) ? storedQuantity : null;
  } catch {
    return null;
  }
}

export function normalizeBomWriteItems(
  rawItems: unknown,
  unitByMaterial: Map<string, string>,
  packageMaterialIds: Set<string>
): BomWriteItem[] {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new Error("整机用料清单至少需要一条物料明细");
  const base = rawItems.map((raw: any, index) => ({
    clientKey: String(raw?.clientKey || raw?.id || `line-${index}`).trim(),
    parentClientKey: String(raw?.parentClientKey || raw?.parentItemId || "").trim() || null,
    materialId: String(raw?.materialId || "").trim(),
    rawQuantity: raw?.quantity,
    sortOrder: Number.isFinite(Number(raw?.sortOrder)) ? Number(raw.sortOrder) : index * 10,
  }));
  const byKey = new Map(base.map((item) => [item.clientKey, item]));
  if (byKey.size !== base.length) throw new Error("整机用料清单明细标识重复");
  const siblingMaterials = new Set<string>();
  for (const item of base) {
    if (!item.materialId || !unitByMaterial.has(item.materialId)) throw new Error("整机用料清单中存在无效或已停用物料");
    if (item.parentClientKey && !byKey.has(item.parentClientKey)) throw new Error("整机用料清单存在无效父级");
    if (item.parentClientKey === item.clientKey) throw new Error("整机用料清单存在循环父子关系");
    const siblingMaterialKey = `${item.parentClientKey || "ROOT"}:${item.materialId}`;
    if (siblingMaterials.has(siblingMaterialKey)) throw new Error("同一层级不能重复加入相同物料");
    siblingMaterials.add(siblingMaterialKey);
  }
  const parentKeys = new Set(base.map((item) => item.parentClientKey).filter(Boolean));
  for (const item of base) {
    if (parentKeys.has(item.clientKey) && !packageMaterialIds.has(item.materialId)) {
      throw new Error("只有归入零件包分类的物料可以作为虚拟分组并添加子物料");
    }
    if (packageMaterialIds.has(item.materialId) && !parentKeys.has(item.clientKey)) {
      throw new Error("虚拟零件包至少需要包含一个子物料");
    }
  }

  const levels = new Map<string, number>();
  const visiting = new Set<string>();
  const levelOf = (key: string): number => {
    if (levels.has(key)) return levels.get(key)!;
    if (visiting.has(key)) throw new Error("整机用料清单存在循环父子关系");
    visiting.add(key);
    const item = byKey.get(key)!;
    const level = item.parentClientKey ? levelOf(item.parentClientKey) + 1 : 1;
    visiting.delete(key);
    levels.set(key, level);
    return level;
  };

  return base.map((item) => {
    const quantity = parseBomQuantity(item.rawQuantity, unitByMaterial.get(item.materialId)!);
    if (!quantity) throw new Error(`物料 ${item.materialId} 的数量无效；计数单位必须为正整数，计量单位必须大于 0`);
    return { ...item, quantity, level: levelOf(item.clientKey) };
  }).sort((a, b) => a.level - b.level || a.sortOrder - b.sortOrder);
}

export function flattenBomLeafRequirements(items: BomTreeItem[], machineQuantity: Prisma.Decimal.Value): BomLeafRequirement[] {
  const machineQty = new Prisma.Decimal(machineQuantity);
  if (!machineQty.isFinite() || !machineQty.gt(0)) throw new Error("生产数量必须大于 0");

  const byId = new Map(items.map((item) => [item.id, item]));
  const children = new Map<string, BomTreeItem[]>();
  for (const item of items) {
    if (item.parentItemId && !byId.has(item.parentItemId)) throw new Error("整机用料清单存在无效父级");
    if (item.parentItemId) children.set(item.parentItemId, [...(children.get(item.parentItemId) || []), item]);
  }

  const state = new Map<string, "visiting" | "done">();
  const assertAcyclic = (item: BomTreeItem) => {
    if (state.get(item.id) === "visiting") throw new Error("整机用料清单存在循环父子关系");
    if (state.get(item.id) === "done") return;
    state.set(item.id, "visiting");
    for (const child of children.get(item.id) || []) assertAcyclic(child);
    state.set(item.id, "done");
  };
  for (const item of items) assertAcyclic(item);

  const totals = new Map<string, BomLeafRequirement>();
  const visit = (item: BomTreeItem, parentQuantity: Prisma.Decimal) => {
    const pathQuantity = parentQuantity.mul(item.quantity);
    const descendants = children.get(item.id) || [];
    if (descendants.length > 0) {
      for (const child of descendants.sort((a, b) => a.sortOrder - b.sortOrder)) visit(child, pathQuantity);
      return;
    }
    const previous = totals.get(item.materialId);
    const perUnitQuantity = (previous?.perUnitQuantity || new Prisma.Decimal(0)).add(pathQuantity);
    totals.set(item.materialId, {
      materialId: item.materialId,
      sourceItemId: previous?.sourceItemId || item.id,
      perUnitQuantity,
      requiredQuantity: perUnitQuantity.mul(machineQty),
      sortOrder: Math.min(previous?.sortOrder ?? item.sortOrder, item.sortOrder),
    });
  };

  for (const root of items.filter((item) => !item.parentItemId).sort((a, b) => a.sortOrder - b.sortOrder)) {
    visit(root, new Prisma.Decimal(1));
  }
  return [...totals.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.materialId.localeCompare(b.materialId));
}
