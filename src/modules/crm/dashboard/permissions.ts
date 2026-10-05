import { canAccessCrmDashboard } from "@/lib/dashboard-access";
import { canSeeAllData, customerIsolationWhere, matchesTerritory, type SessionUser } from "@/lib/permissions";

export class CrmDashboardAccessError extends Error {}

export function assertCrmDashboardAccess(user: SessionUser) {
  if (!canAccessCrmDashboard(user.role)) throw new CrmDashboardAccessError("无权限访问 CRM工作台");
}

export function crmDashboardScope(user: SessionUser, requested: { province?: string; salesUserId?: string }) {
  assertCrmDashboardAccess(user);
  const isAdmin = canSeeAllData(user);
  const scope: any = isAdmin ? {} : customerIsolationWhere(user);
  const province = String(requested.province || "").trim();
  const salesUserId = String(requested.salesUserId || "").trim();

  if (province) {
    if (isAdmin || (user.territories || []).some((territory) => matchesTerritory([territory], province))) {
      scope.province = province;
    } else {
      scope.id = "__NO_ACCESS__";
    }
  }

  // 非超管只可按本人过滤；其他值只能使结果为空，绝不扩大可见范围。
  if (salesUserId) {
    if (isAdmin || salesUserId === user.id) scope.assignedUserId = salesUserId;
    else scope.id = "__NO_ACCESS__";
  }

  return { scope, isAdmin, selectedSalesUserId: isAdmin || salesUserId === user.id ? salesUserId : "" };
}
