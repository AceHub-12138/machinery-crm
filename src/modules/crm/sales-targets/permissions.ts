import { canAccessCrmDashboard } from "@/lib/dashboard-access";
import type { SessionUser } from "@/lib/permissions";
import { DomainError } from "@/modules/shared/domain-error";

export function assertCanReadSalesTarget(user: SessionUser) {
  if (!canAccessCrmDashboard(user.role)) {
    throw new DomainError("无权限访问 CRM工作台", 403);
  }
}

export function assertCanManageSalesTarget(user: SessionUser) {
  if (user.role !== "SUPER_ADMIN") {
    throw new DomainError("无权限设置销售目标", 403);
  }
}
