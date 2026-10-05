type ThresholdMaterial = {
  safetyStock?: unknown;
  safetyStockEnabled?: unknown;
  category?: { warningThreshold?: unknown } | null;
};

function positiveFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

/**
 * 物料级阈值仅在"启用安全库存"勾选后生效；字段缺失时（旧调用方/旧数据）按启用处理，保持历史行为。
 * 安全库存为 0 表示该物料未设置阈值，不能把 0 当作补货线。
 */
function materialLevelThresholdActive(material: ThresholdMaterial): boolean {
  return material.safetyStockEnabled === undefined ? true : Boolean(material.safetyStockEnabled);
}

/**
 * 预警线口径（台账、工作台、统一待办、AI 查询共用）：
 * 1. 物料勾选"启用安全库存"且安全库存 > 0 → 按物料安全库存预警；
 * 2. 否则回退到物料分类预警线；
 * 3. 都没有 → 不预警。
 */
export function resolveInventoryWarningThreshold(material: ThresholdMaterial): number | null {
  if (materialLevelThresholdActive(material)) {
    const safetyStock = positiveFiniteNumber(material.safetyStock);
    if (safetyStock !== null) return safetyStock;
  }
  return positiveFiniteNumber(material.category?.warningThreshold);
}

export function isInventoryBelowWarningThreshold(quantity: unknown, material: ThresholdMaterial): boolean {
  const threshold = resolveInventoryWarningThreshold(material);
  const stock = Number(quantity);
  return threshold !== null && Number.isFinite(stock) && stock <= threshold;
}
