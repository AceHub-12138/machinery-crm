import type { SessionUser } from "@/lib/permissions";

/** CRM 领域的服务层入口权限；页面或 middleware 不能替代它。 */
export function canAccessCrmData(user: SessionUser): boolean {
  return user.role === "SUPER_ADMIN" || user.role === "SALES" || user.role === "FOREIGN_TRADE";
}
