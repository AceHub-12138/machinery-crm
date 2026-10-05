import { z } from "zod/v4";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { DomainError } from "@/modules/shared/domain-error";

const assignmentInputSchema = z.object({
  leadIds: z.array(z.string().trim().min(1).max(191)).min(1).max(100),
  assignedUserId: z.string().trim().min(1).max(191),
}).strict().superRefine((value, context) => {
  if (new Set(value.leadIds).size !== value.leadIds.length) {
    context.addIssue({ code: "custom", path: ["leadIds"], message: "Lead 不能重复选择" });
  }
});

function assertCanAssignLeads(user: SessionUser) {
  if (user.role !== "SUPER_ADMIN") throw new DomainError("只有超级管理员可以分配 Lead", 403);
}

export async function listLeadAssignees(user: SessionUser) {
  assertCanAssignLeads(user);
  return prisma.user.findMany({
    where: { isActive: true, role: { in: ["SALES", "FOREIGN_TRADE"] } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }, { id: "asc" }],
  });
}

export async function assignHumanLeads(user: SessionUser, input: unknown) {
  assertCanAssignLeads(user);
  const parsed = assignmentInputSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("分配参数不合法");
  const { leadIds, assignedUserId } = parsed.data;

  return prisma.$transaction(async (tx) => {
    const assignee = await tx.user.findUnique({
      where: { id: assignedUserId },
      select: { id: true, role: true, isActive: true },
    });
    if (!assignee || !assignee.isActive || !["SALES", "FOREIGN_TRADE"].includes(assignee.role)) {
      throw new DomainError("目标负责人必须是启用的销售或外贸销售账号");
    }

    const leads = await tx.$queryRaw<Array<{ id: string; assignedUserId: string | null }>>(
      Prisma.sql`SELECT id, assignedUserId FROM leads WHERE id IN (${Prisma.join(leadIds)}) FOR UPDATE`,
    );
    if (leads.length !== leadIds.length) throw new DomainError("部分 Lead 不存在", 404);
    const leadById = new Map(leads.map((lead) => [lead.id, lead]));
    const items = [];
    for (const leadId of leadIds) {
      const lead = leadById.get(leadId)!;
      if (lead.assignedUserId === assignedUserId) {
        items.push({ id: leadId, assignedUserId });
        continue;
      }
      const updated = await tx.lead.update({
        where: { id: leadId },
        data: { assignedUserId },
        select: { id: true, assignedUserId: true },
      });
      await writeOperationLog(tx, {
        userId: user.id,
        action: lead.assignedUserId === null ? "MANUAL_ASSIGN" : "REASSIGN",
        entityType: "Lead",
        entityId: leadId,
        beforeData: { assignedUserId: lead.assignedUserId },
        afterData: { assignedUserId },
      });
      items.push(updated);
    }
    return { items };
  });
}
