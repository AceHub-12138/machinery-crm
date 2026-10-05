export const ERP_ROLES = ["SUPER_ADMIN", "PURCHASE", "WAREHOUSE"] as const;
export const REGION_SCOPED_ROLES = ["SALES", "FOREIGN_TRADE"] as const;

export type AppRole = (typeof ERP_ROLES)[number] | (typeof REGION_SCOPED_ROLES)[number];

export const ROLE_LABELS: Record<AppRole, string> = {
  SUPER_ADMIN: "超级管理员",
  SALES: "销售",
  FOREIGN_TRADE: "外贸业务",
  PURCHASE: "采购",
  WAREHOUSE: "仓库管理",
};

export function roleRequiresRegionScope(role: string): boolean {
  return (REGION_SCOPED_ROLES as readonly string[]).includes(role);
}

export function customerBusinessLineForRole(role: string): "国内销售" | "外贸" {
  return role === "FOREIGN_TRADE" ? "外贸" : "国内销售";
}

export function canViewERP(role: string): boolean {
  return (ERP_ROLES as readonly string[]).includes(role);
}

export function canManageSuppliers(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "PURCHASE";
}

export function canManagePurchaseOrders(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "PURCHASE";
}

/** 采购需求与采购订单是不同动作：仓库可处理需求，但不能下采购订单。 */
export function canManagePurchaseDemands(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "PURCHASE" || role === "WAREHOUSE";
}

export function canManageInventory(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "WAREHOUSE";
}

export function canManageBom(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "WAREHOUSE";
}

export function canManageMaterialMaster(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "WAREHOUSE";
}

export function canPublishProductionOrder(role: string): boolean {
  return role === "SUPER_ADMIN";
}

export function canExecuteKitCheck(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "WAREHOUSE";
}

// FULL_READ_ONLY MCP 已按独立角色矩阵完成验收；UI 权限扩展不得隐式扩大远程工具调用面。
export function canReadMcpBomDetail(role: string): boolean {
  return role === "SUPER_ADMIN";
}

export function canRunMcpKitCheck(role: string): boolean {
  return role === "SUPER_ADMIN";
}

export function canManageProductionMaterial(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "WAREHOUSE";
}
