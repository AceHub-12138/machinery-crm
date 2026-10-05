export const shortageSourceDuplicateMessage = "同一工单、同一次齐套检查、同一物料已经存在有效采购草稿或采购单";
export const shortageSourceMaterialChangeMessage = "缺料生成的采购草稿只能调整来源物料的数量和单价，不能替换或增减物料";
export const shortageSourceUniqueConflictMessage = "该齐套检查中的此物料已生成有效采购草稿，请勿重复提交。";

type PrismaErrorLike = {
  code?: unknown;
  meta?: { target?: unknown };
};

function uniqueTargetText(error: PrismaErrorLike) {
  const target = error.meta?.target;
  return (Array.isArray(target) ? target : [target]).filter((value) => value !== undefined && value !== null).map((value) => String(value).toLowerCase()).join(" ");
}

export function isShortageSourceUniqueConflict(error: PrismaErrorLike) {
  if (error.code !== "P2002") return false;
  const target = uniqueTargetText(error);
  return target.includes("erp_purchase_order_shortage_sources") || ["kitcheckid", "materialid", "isactive"].every((field) => target.includes(field));
}

export function shortageSourceUniqueConflictResponse(error: PrismaErrorLike) {
  return isShortageSourceUniqueConflict(error) ? { status: 409 as const, error: shortageSourceUniqueConflictMessage } : null;
}

export function shouldRetryShortagePurchaseCreation(error: PrismaErrorLike, attempt: number) {
  return !isShortageSourceUniqueConflict(error) && (error.code === "P2002" || error.code === "P2034") && attempt < 2;
}

export function hasActiveShortageSourceClaim(claims: ReadonlyArray<unknown>) {
  return claims.length > 0;
}

export function hasShortageSourceMaterialMismatch(sourceMaterialIds: ReadonlyArray<string>, requestedMaterialIds: ReadonlyArray<string>) {
  const sourceIds = new Set(sourceMaterialIds);
  return sourceIds.size !== requestedMaterialIds.length || requestedMaterialIds.some((materialId) => !sourceIds.has(materialId));
}

export function releaseShortageSource(releasedAt: Date) {
  return { isActive: null, releasedAt };
}
