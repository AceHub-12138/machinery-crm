import type { SessionUser } from "@/lib/permissions";

export const PERMISSION_ACTIONS = ["VIEW", "CREATE", "UPDATE", "DELETE", "REQUEST_DELETE", "APPROVE", "PRINT", "EXPORT", "CONFIGURE", "VIEW_AUDIT"] as const;
export const PERMISSION_MODULES = ["CRM_CUSTOMER", "CRM_CONTRACT", "CRM_SHIPMENT", "ERP_PURCHASE", "ERP_INVENTORY", "ERP_PRODUCTION", "ERP_KIT_CHECK", "SYSTEM_USER", "SYSTEM_CONFIG", "SYSTEM_AUDIT", "SYSTEM_HEALTH"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

const rolePermissions: Record<string, readonly string[]> = {
  SALES: ["CRM_CUSTOMER.VIEW", "CRM_CUSTOMER.CREATE", "CRM_CUSTOMER.UPDATE", "CRM_CONTRACT.VIEW", "CRM_SHIPMENT.VIEW"],
  FOREIGN_TRADE: ["CRM_CUSTOMER.VIEW", "CRM_CUSTOMER.CREATE", "CRM_CUSTOMER.UPDATE", "CRM_CONTRACT.VIEW", "CRM_SHIPMENT.VIEW"],
  PURCHASE: ["ERP_PURCHASE.VIEW", "ERP_PURCHASE.CREATE", "ERP_PURCHASE.UPDATE", "ERP_INVENTORY.VIEW", "ERP_PRODUCTION.VIEW", "ERP_KIT_CHECK.VIEW"],
  WAREHOUSE: ["ERP_PURCHASE.VIEW", "ERP_PURCHASE.CREATE", "ERP_INVENTORY.VIEW", "ERP_INVENTORY.CREATE", "ERP_INVENTORY.UPDATE", "ERP_PRODUCTION.VIEW", "ERP_KIT_CHECK.VIEW", "ERP_KIT_CHECK.CREATE"],
};

/** 超管永远全权限；现有 API 的专用校验仍是动态权限落地前的硬兜底。 */
export function hasPermission(user: SessionUser, module: PermissionModule, action: PermissionAction) {
  if (user.role === "SUPER_ADMIN") return true;
  return rolePermissions[user.role]?.includes(`${module}.${action}`) ?? false;
}

export function permissionMatrixForRole(role: SessionUser["role"]) {
  return PERMISSION_MODULES.map((module) => ({
    module,
    actions: PERMISSION_ACTIONS.filter((action) => role === "SUPER_ADMIN" || rolePermissions[role]?.includes(`${module}.${action}`)),
  }));
}
