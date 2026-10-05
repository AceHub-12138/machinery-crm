/**
 * 候选入池与人工反查：入池写现有 Lead 表并按省自动分单（复用 lead-routing 决策函数，
 * 与 MCP lead_upsert 生产语义一致：匹配 0 个/多个销售时保持未指派，绝不随机指派）。
 * prisma/天眼查均可注入（单测用 fake；业务调用走默认单例）。
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import { writeOperationLog } from "@/lib/sales-items";
import type { SessionUser } from "@/lib/customer-permissions";
import { companyDedupKey } from "@/lib/lead-hunter/dedup";
import { createTianyanchaClient, type TianyanchaClient } from "@/lib/lead-hunter/tianyancha";
import type { LeadHuntTaskConfig } from "@/lib/lead-hunter/types";
import { DomainError } from "@/modules/shared/domain-error";
import { leadRoutingAuditAction, resolveLeadAssignee, type LeadRoutingCandidate } from "@/modules/crm/leads/lead-routing";

export type AdmitDeps = { prisma?: PrismaClient; tianyancha?: TianyanchaClient };

export type AdmitResult = {
  admitted: number;
  results: Array<{ candidateId: string; leadId: string | null; assignedUserId: string | null; replay: boolean }>;
};

export async function admitCandidates(user: SessionUser, taskId: string, candidateIds: string[], deps?: AdmitDeps): Promise<AdmitResult> {
  const prisma = deps?.prisma ?? defaultPrisma;
  if (!Array.isArray(candidateIds) || candidateIds.length < 1 || candidateIds.length > 50) {
    throw new DomainError("请勾选 1~50 条候选");
  }
  const task = await prisma.leadHuntTask.findUnique({ where: { id: taskId }, select: { id: true } });
  if (!task) throw new DomainError("任务不存在", 404);

  const candidates = await prisma.leadHuntCandidate.findMany({
    where: { taskId, id: { in: candidateIds }, status: { notIn: ["DISCARDED", "LOOKING_UP"] } },
  });
  if (candidates.length < 1) throw new DomainError("勾选的候选不存在或状态不允许入池");

  const routingCandidates: LeadRoutingCandidate[] = await prisma.user.findMany({
    where: { isActive: true, role: { in: ["SALES", "FOREIGN_TRADE"] } },
    select: { id: true, role: true, isActive: true, territories: true },
  });

  const results: AdmitResult["results"] = [];
  for (const candidate of candidates) {
    if (candidate.status === "ADMITTED") {
      // 重复勾选已入池候选：按幂等回执处理，不重复建线索
      const known = candidate.leadId
        ? await prisma.lead.findUnique({ where: { id: candidate.leadId }, select: { id: true, assignedUserId: true } })
        : null;
      results.push({ candidateId: candidate.id, leadId: known?.id ?? candidate.leadId ?? null, assignedUserId: known?.assignedUserId ?? null, replay: true });
      continue;
    }
    const idempotencyKey = `lead-hunter-${candidate.id}`;
    const keywordText = Array.isArray(candidate.keywords)
      ? (candidate.keywords as unknown[]).map((item) => String(item)).join("；").slice(0, 191)
      : null;

    const lead = await prisma.$transaction(async (tx) => {
      const known = await tx.lead.findUnique({ where: { idempotencyKey }, select: { id: true, assignedUserId: true } });
      if (known) return known;

      const profile = {
        ...(candidate.province ? { province: candidate.province } : {}),
        ...(candidate.city ? { city: candidate.city } : {}),
        ...(candidate.scoreReason ? { summary: candidate.scoreReason } : {}),
      };
      const routing = resolveLeadAssignee(profile, routingCandidates);
      const created = await tx.lead.create({
        data: {
          companyName: candidate.companyName,
          phone: candidate.phone,
          email: candidate.email,
          source: "BAIDU_SEARCH",
          sourceUrl: candidate.sourceUrl,
          searchKeyword: keywordText,
          aiScore: candidate.score,
          profile,
          sourceSystem: "lead-hunter",
          idempotencyKey,
          dedupKey: companyDedupKey(candidate.companyName),
          assignedUserId: routing.assignedUserId,
        },
        select: { id: true, assignedUserId: true },
      });
      await writeOperationLog(tx, {
        userId: user.id,
        action: leadRoutingAuditAction(routing),
        entityType: "Lead",
        entityId: created.id,
        afterData: { candidateId: candidate.id, assignedUserId: created.assignedUserId, routingReason: routing.reason },
      });
      return created;
    }).catch(async (error) => {
      // 并发下 dedupKey/idempotencyKey 撞唯一键：找回已写入的线索按幂等处理
      if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
      const known = await prisma.lead.findUnique({ where: { idempotencyKey }, select: { id: true, assignedUserId: true } });
      if (!known) throw error;
      return known;
    });

    await prisma.leadHuntCandidate.update({
      where: { id: candidate.id },
      data: { status: "ADMITTED", leadId: lead.id },
    });
    results.push({
      candidateId: candidate.id,
      leadId: lead.id,
      assignedUserId: lead.assignedUserId,
      replay: candidate.leadId === lead.id,
    });
  }

  return { admitted: results.length, results };
}

export type ReverseLookupResult = {
  lookedUp: number;
  found: number;
  failed: number;
  remainingQuota: number;
};

/** 人工勾选反查（天眼查）：只对「无联系方式-待反查」候选生效，受每日上限护栏约束 */
export async function reverseLookupCandidates(
  user: SessionUser,
  taskId: string,
  candidateIds: string[],
  deps?: AdmitDeps,
): Promise<ReverseLookupResult> {
  const prisma = deps?.prisma ?? defaultPrisma;
  if (!Array.isArray(candidateIds) || candidateIds.length < 1 || candidateIds.length > 50) {
    throw new DomainError("请勾选 1~50 条候选");
  }
  const task = await prisma.leadHuntTask.findUnique({ where: { id: taskId } });
  if (!task) throw new DomainError("任务不存在", 404);
  const config = task.config as unknown as LeadHuntTaskConfig;
  const tianyancha = deps?.tianyancha ?? createTianyanchaClient();

  const candidates = await prisma.leadHuntCandidate.findMany({
    where: { taskId, id: { in: candidateIds }, status: "NO_CONTACT" },
    orderBy: [{ score: "desc" }, { createdAt: "asc" }],
  });
  if (candidates.length < 1) throw new DomainError("勾选的候选不存在，或状态不是「无联系方式-待反查」");

  const remainingQuota = config.dailyLookupLimit - tianyancha.todayCallCount();
  if (remainingQuota < candidates.length) {
    throw new DomainError(
      `本次需反查 ${candidates.length} 次，但今日天眼查剩余额度只有 ${Math.max(remainingQuota, 0)} 次（每日上限 ${config.dailyLookupLimit} 次），请减少勾选数量或调高上限`,
      409,
    );
  }

  let found = 0;
  let failed = 0;
  for (const candidate of candidates) {
    await prisma.leadHuntCandidate.update({ where: { id: candidate.id }, data: { status: "LOOKING_UP" } });
    const lookup = await tianyancha.lookupCompany(candidate.companyName);
    if (lookup.found && lookup.phone) found += 1;
    else failed += 1;
    await prisma.leadHuntCandidate.update({
      where: { id: candidate.id },
      data: {
        status: lookup.found && lookup.phone ? "LOOKUP_FOUND" : "LOOKUP_FAILED",
        tianyancha: lookup.raw as Prisma.InputJsonValue,
        ...(lookup.phone ? { phone: lookup.phone } : {}),
      },
    });
  }

  await prisma.$transaction(async (tx) => {
    await writeOperationLog(tx, {
      userId: user.id,
      action: "LEAD_HUNTER_REVERSE_LOOKUP",
      entityType: "LeadHuntTask",
      entityId: taskId,
      afterData: { candidateIds: candidates.map((candidate) => candidate.id), found, failed },
    });
  });

  return { lookedUp: candidates.length, found, failed, remainingQuota: config.dailyLookupLimit - tianyancha.todayCallCount() };
}
