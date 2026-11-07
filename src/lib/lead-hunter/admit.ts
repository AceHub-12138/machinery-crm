import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import { writeOperationLog } from "@/lib/sales-items";
import type { SessionUser } from "@/lib/customer-permissions";
import { companyDedupKey } from "./dedup";
import { LEAD_ADMIT_MIN_SCORE } from "./types";
import { extractEmails, pagePhoneEvidence, verifiedPageContact } from "./phone";
import { findExistingLeadCustomer } from "./existing-customer";
import { DomainError } from "@/modules/shared/domain-error";
import { leadRoutingAuditAction, resolveLeadAssignee } from "@/modules/crm/leads/lead-routing";
export type AdmitResultItem = {
  candidateId: string; status: "ADMITTED" | "ALREADY_IN_POOL" | "REJECTED"; reason: string;
  leadId: string | null; assignedUserId: string | null; replay: boolean;
};
export type AdmitResult = { admitted: number; results: AdmitResultItem[] };
export async function admitCandidates(user: SessionUser, taskId: string, candidateIds: string[], deps?: { prisma?: PrismaClient }): Promise<AdmitResult> {
  if (user.role !== "SUPER_ADMIN") throw new DomainError("只有超级管理员可以入池", 403);
  if (!candidateIds.length || candidateIds.length > 50 || candidateIds.some((id) => !id || id.length > 191)) throw new DomainError("请勾选 1~50 条候选");
  const db = deps?.prisma ?? defaultPrisma;
  if (!await db.leadHuntTask.findUnique({ where: { id: taskId }, select: { id: true } })) throw new DomainError("任务不存在", 404);
  const results: AdmitResultItem[] = [];
  for (const candidateId of [...new Set(candidateIds)]) {
    const rejected = (reason: string): AdmitResultItem => ({ candidateId, status: "REJECTED", reason, leadId: null, assignedUserId: null, replay: false });
    const duplicate = async (tx: Prisma.TransactionClient, lead: { id: string; assignedUserId: string | null }) => {
      await tx.leadHuntCandidate.update({ where: { id: candidateId }, data: { status: "ALREADY_IN_POOL", leadId: lead.id } });
      return { candidateId, status: "ALREADY_IN_POOL" as const, reason: "已在线索池", leadId: lead.id, assignedUserId: lead.assignedUserId, replay: true };
    };
    try {
      results.push(await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM lead_hunt_candidates WHERE id = ${candidateId} AND taskId = ${taskId} FOR UPDATE`;
        const candidate = await tx.leadHuntCandidate.findUnique({ where: { id: candidateId } });
        if (!candidate || candidate.taskId !== taskId) return rejected("候选不存在");
        const idempotencyKey = "lead-hunter-" + candidate.id;
        const dedupKey = companyDedupKey(candidate.companyName);
        const known = await tx.lead.findFirst({ where: { OR: [{ idempotencyKey }, { dedupKey }] }, select: { id: true, assignedUserId: true } });
        if (known && ["ADMITTED", "ALREADY_IN_POOL", "PENDING_CONFIRM", "NO_CONTACT"].includes(candidate.status)) return duplicate(tx, known);
        if (candidate.score === null || candidate.score < LEAD_ADMIT_MIN_SCORE) return rejected("AI 评分必须 ≥ 85 分");
        if (!["PENDING_CONFIRM", "NO_CONTACT"].includes(candidate.status)) return rejected("状态不允许入池：" + candidate.status);
        const evidence = candidate.phoneEvidence && typeof candidate.phoneEvidence === "object" && !Array.isArray(candidate.phoneEvidence) ? candidate.phoneEvidence : null;
        const sourceText = [candidate.snippet ?? "", typeof evidence?.excerpt === "string" ? evidence.excerpt : ""].join("\n");
        const phone = verifiedPageContact(candidate.phone, sourceText);
        const email = candidate.email && extractEmails(sourceText).includes(candidate.email.toLowerCase()) ? candidate.email.toLowerCase() : null;
        const customer = await findExistingLeadCustomer(tx, candidate.companyName, phone);
        if (customer) {
          await tx.leadHuntCandidate.update({ where: { id: candidateId }, data: { status: "EXISTING_CUSTOMER", statusReason: customer.companyName.slice(0, 191) } });
          return rejected("已是客户：" + customer.companyName);
        }
        const profile = { ...(candidate.province ? { province: candidate.province } : {}), ...(candidate.city ? { city: candidate.city } : {}), ...(candidate.scoreReason ? { summary: candidate.scoreReason } : {}) };
        const users = phone ? await tx.user.findMany({ where: { isActive: true, role: { in: ["SALES", "FOREIGN_TRADE"] } }, select: { id: true, role: true, isActive: true, territories: true } }) : [];
        const routing = resolveLeadAssignee(profile, users);
        const phoneEvidence = phone ? pagePhoneEvidence(candidate.sourceUrl, sourceText, phone) : undefined;
        const lead = await tx.lead.create({
          data: {
            companyName: candidate.companyName, contactName: candidate.contactName, phone, email, source: "BAIDU_SEARCH",
            sourceUrl: candidate.sourceUrl, searchKeyword: Array.isArray(candidate.keywords) ? candidate.keywords.map(String).join("；").slice(0, 191) : null,
            aiScore: candidate.score, profile, sourceSystem: "lead-hunter", idempotencyKey, dedupKey,
            assignedUserId: phone ? routing.assignedUserId : null, contactStatus: phone ? "HAS_CONTACT" : "PENDING_LOOKUP",
            contactStatusUpdatedAt: new Date(), phoneSource: phone ? "PAGE_TEXT" : null, phoneEvidence, phoneVerifiedAt: phone ? new Date() : null,
          }, select: { id: true, assignedUserId: true },
        });
        await tx.leadHuntCandidate.update({ where: { id: candidateId }, data: { status: "ADMITTED", leadId: lead.id, phone, email, phoneSource: phone ? "PAGE_TEXT" : null, phoneEvidence: phoneEvidence ?? Prisma.DbNull } });
        await tx.$executeRaw`UPDATE lead_hunt_tasks SET report = JSON_SET(COALESCE(report, JSON_OBJECT()), '$.admitted', COALESCE(JSON_EXTRACT(report, '$.admitted'), 0) + 1) WHERE id = ${taskId}`;
        await writeOperationLog(tx, { userId: user.id, action: phone ? leadRoutingAuditAction(routing) : "AUTO_ASSIGN_DEFERRED|reason=NO_CONTACT", entityType: "Lead", entityId: lead.id, afterData: { candidateId, assignedUserId: lead.assignedUserId } });
        return { candidateId, status: "ADMITTED" as const, reason: phone ? "入池成功" : "入池成功，待管理员反查", leadId: lead.id, assignedUserId: lead.assignedUserId, replay: false };
      }));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        const candidate = await db.leadHuntCandidate.findUnique({ where: { id: candidateId } });
        const known = candidate ? await db.lead.findFirst({ where: { OR: [{ idempotencyKey: "lead-hunter-" + candidate.id }, { dedupKey: companyDedupKey(candidate.companyName) }] }, select: { id: true, assignedUserId: true } }) : null;
        results.push(known ? await db.$transaction((tx) => duplicate(tx, known)) : rejected("入池发生冲突，请刷新后重试"));
      } else {
        console.error("[lead-hunter.admit] 单条入池失败", { candidateId });
        results.push(rejected("该条入池失败，请重试"));
      }
    }
  }
  return { admitted: results.filter((row) => row.status === "ADMITTED").length, results };
}
