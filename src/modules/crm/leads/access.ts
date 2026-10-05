import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/permissions";
import { DomainError } from "@/modules/shared/domain-error";

export function leadVisibilityWhere(user: SessionUser): Prisma.LeadWhereInput {
  if (user.role === "SUPER_ADMIN") return {};
  if (user.role === "SALES" || user.role === "FOREIGN_TRADE") {
    return { assignedUserId: user.id };
  }
  throw new DomainError("无权限访问 AI 线索池", 403);
}

export function assertLeadAccess(
  user: SessionUser,
  lead: { assignedUserId: string | null },
  deniedMessage = "只能访问明确指派给本人的 Lead",
) {
  leadVisibilityWhere(user);
  if (user.role !== "SUPER_ADMIN" && lead.assignedUserId !== user.id) {
    throw new DomainError(deniedMessage, 403);
  }
}
