export type DashboardRole = "SUPER_ADMIN" | "SALES" | "FOREIGN_TRADE" | "PURCHASE" | "WAREHOUSE";

export function canAccessCrmDashboard(role: string | null | undefined): boolean {
  return role === "SUPER_ADMIN" || role === "SALES" || role === "FOREIGN_TRADE";
}

export function canAccessErpDashboard(role: string | null | undefined): boolean {
  return role === "SUPER_ADMIN" || role === "PURCHASE" || role === "WAREHOUSE";
}

export function dashboardHomeForRole(role: string | null | undefined): "/dashboard/crm" | "/dashboard/erp" | null {
  if (canAccessCrmDashboard(role)) return "/dashboard/crm";
  if (canAccessErpDashboard(role)) return "/dashboard/erp";
  return null;
}

export function erpDashboardRoleView(role: string | null | undefined): "ADMIN" | "PURCHASE" | "WAREHOUSE" | null {
  if (role === "SUPER_ADMIN") return "ADMIN";
  if (role === "PURCHASE") return "PURCHASE";
  if (role === "WAREHOUSE") return "WAREHOUSE";
  return null;
}
