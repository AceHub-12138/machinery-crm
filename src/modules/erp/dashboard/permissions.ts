import { erpDashboardRoleView } from "@/lib/dashboard-access";
import type { SessionUser } from "@/lib/permissions";

export class ErpDashboardAccessError extends Error {}

export function resolveErpDashboardView(user: SessionUser) {
  const roleView = erpDashboardRoleView(user.role);
  if (!roleView) throw new ErpDashboardAccessError("无权限访问 ERP工作台");
  return roleView;
}

export function canSeeProcurementDetails(roleView: "ADMIN" | "PURCHASE" | "WAREHOUSE") { return roleView === "ADMIN" || roleView === "PURCHASE"; }
export function canSeeInventoryAmount(roleView: "ADMIN" | "PURCHASE" | "WAREHOUSE") { return roleView === "ADMIN" || roleView === "WAREHOUSE"; }
