import { Prisma, type Lead, type LeadContactLookup, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import type { SessionUser } from "@/lib/permissions";
import { DomainError } from "@/modules/shared/domain-error";
import { writeOperationLog } from "@/lib/sales-items";
import { normalizedCompanyName } from "@/lib/lead-hunter/dedup";
import { leadRuntimeFlags, tycConfigured } from "@/lib/lead-hunter/runtime-flags";
import { companyOperatingStatus, createTianyanchaClient, matchCompanyIdentity, type TianyanchaClient, type TianyanchaLookup } from "@/lib/lead-hunter/tianyancha";
import { sanitizeEmails, splitAndSanitizePhones } from "@/lib/lead-hunter/phone";
import { leadRoutingAuditAction, resolveLeadAssignee } from "./lead-routing";

export const CONTACT_STATUSES = ["HAS_CONTACT", "PENDING_LOOKUP", "LOOKING_UP", "NEEDS_CONFIRM", "LOOKUP_FAILED"] as const;
type Deps = { prisma?: PrismaClient; client?: TianyanchaClient; now?: () => Date; configured?: () => boolean; signal?: AbortSignal };
type Outcome = { status: "FOUND" | "NEEDS_CONFIRM" | "NOT_FOUND" | "FAILED"; reason: string | null };
export function requireContactAdmin(user: SessionUser | null) {
  if (!user) throw new DomainError("未登录", 401);
  if (user.role !== "SUPER_ADMIN") throw new DomainError("只有超级管理员可以反查或确认", 403);
}
function boundedInteger(raw: string | undefined, fallback: number, max: number) {
  const value = Number(raw ?? fallback);
  return Number.isInteger(value) && value >= 0 ? Math.min(value, max) : fallback;
}
export function lookupConfig() {
  return { limit: boundedInteger(process.env.LEAD_TYC_DAILY_LIMIT, 20, 500), cacheDays: boundedInteger(process.env.LEAD_TYC_CACHE_DAYS, 30, 365) };
}
export function beijingQuotaDate(now: Date) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export async function reserveLookupQuota(db: PrismaClient, date: string, limit: number) {
  await db.$executeRaw`INSERT IGNORE INTO lead_lookup_daily_quotas (quotaDate, used, updatedAt) VALUES (${date}, 0, UTC_TIMESTAMP(3))`;
  return await db.$executeRaw`UPDATE lead_lookup_daily_quotas SET used = used + 1, updatedAt = UTC_TIMESTAMP(3) WHERE quotaDate = ${date} AND used < ${limit}` > 0;
}
export async function getLookupQuota(user: SessionUser, deps?: Deps) {
  requireContactAdmin(user);
  const db = deps?.prisma ?? defaultPrisma;
  const date = beijingQuotaDate(deps?.now?.() ?? new Date());
  const row = await db.leadLookupDailyQuota.findUnique({ where: { quotaDate: date } });
  return { date, used: row?.used ?? 0, limit: lookupConfig().limit, tycConfigured: deps?.configured?.() ?? tycConfigured(), ...leadRuntimeFlags() };
}
export function classifyLookup(leadName: string, result: TianyanchaLookup): Outcome {
  if (result.isMock) return { status: "FAILED", reason: "模拟数据，不可采用" };
  if (result.outcome !== "FOUND") return { status: result.outcome, reason: result.reason };
  const operating = companyOperatingStatus(result.regStatus);
  if (operating === "INACTIVE") return { status: "NOT_FOUND", reason: "企业状态：" + result.regStatus };
  if (matchCompanyIdentity(leadName, result.companyName, result.historyNames) !== "MATCH") return { status: "NEEDS_CONFIRM", reason: "企业名称不一致" };
  if (operating === "UNKNOWN") return { status: "NEEDS_CONFIRM", reason: "经营状态无法识别" };
  if (!result.phones.length) return { status: "NOT_FOUND", reason: "天眼查无有效电话" };
  return { status: "FOUND", reason: null };
}
function fromCache(row: LeadContactLookup): TianyanchaLookup {
  const raw = row.rawResponse && typeof row.rawResponse === "object" && !Array.isArray(row.rawResponse) ? row.rawResponse as Record<string, unknown> : {};
  const phones = splitAndSanitizePhones(row.phones).map((phone) => phone.value);
  return {
    found: Boolean(row.matchedName), phone: phones[0] ?? null, phones, emails: sanitizeEmails(row.emails),
    legalPerson: null, regAddress: typeof raw.regLocation === "string" ? raw.regLocation : null,
    raw, outcome: row.matchedName ? "FOUND" : "NOT_FOUND", reason: row.reason,
    companyName: row.matchedName, historyNames: Array.isArray(raw.historyNames) ? raw.historyNames.filter((v): v is string => typeof v === "string") : [],
    tycCompanyId: row.tycCompanyId, creditCode: row.creditCode, regStatus: row.regStatus, isMock: row.isMock,
  };
}
async function applyContact(tx: Prisma.TransactionClient, user: SessionUser, lead: Lead, lookupId: string, queryName: string, result: TianyanchaLookup, adopted: boolean, at: Date) {
  const phone = result.phones[0] ?? null;
  const sharedPhoneLeadCount = phone ? await tx.lead.count({ where: { id: { not: lead.id }, phone } }) : 0;
  const sharedCustomer = phone ? await tx.customer.findFirst({ where: { deletedAt: null, phone }, select: { companyName: true } }) : null;
  const evidence = { lookupId, tycCompanyId: result.tycCompanyId, matchedName: result.companyName, queryName, creditCode: result.creditCode, regStatus: result.regStatus, allPhones: result.phones, allEmails: result.emails, queriedAt: at.toISOString(), sharedPhoneLeadCount, sharedPhoneCustomer: sharedCustomer?.companyName ?? null, ...(adopted ? { manuallyConfirmed: true } : {}) };
  let assignedUserId = lead.assignedUserId;
  if (phone && !assignedUserId) {
    const users = await tx.user.findMany({ where: { isActive: true, role: { in: ["SALES", "FOREIGN_TRADE"] } }, select: { id: true, role: true, territories: true, isActive: true } });
    const routing = resolveLeadAssignee(lead.profile, users);
    assignedUserId = routing.assignedUserId;
    await writeOperationLog(tx, { userId: user.id, action: leadRoutingAuditAction(routing), entityType: "Lead", entityId: lead.id, afterData: { lookupId, assignedUserId } });
  }
  await tx.lead.update({ where: { id: lead.id }, data: {
    contactStatus: phone ? "HAS_CONTACT" : "LOOKUP_FAILED", contactStatusUpdatedAt: at,
    tycCompanyId: result.tycCompanyId, creditCode: result.creditCode,
    ...(!lead.email && result.emails[0] ? { email: result.emails[0] } : {}),
    ...(phone ? { phone, phoneSource: "TIANYANCHA", phoneEvidence: evidence, phoneVerifiedAt: at, assignedUserId } : {}),
  } });
}
export async function lookupLeadContact(user: SessionUser, leadId: string, input: unknown, deps?: Deps) {
  requireContactAdmin(user);
  const db = deps?.prisma ?? defaultPrisma;
  const now = deps?.now ?? (() => new Date());
  const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  if (body.queryName !== undefined && (typeof body.queryName !== "string" || !body.queryName.trim() || body.queryName.trim().length > 100)) throw new DomainError("查询全称须为 1~100 个字");
  if (!(deps?.configured?.() ?? tycConfigured())) throw new DomainError("天眼查未配置", 503);
  const original = await db.lead.findUnique({ where: { id: leadId } });
  if (!original) throw new DomainError("线索不存在", 404);
  const queryName = typeof body.queryName === "string" ? body.queryName.trim() : original.companyName.trim();
  if (!queryName || queryName.length > 100) throw new DomainError("请指定不超过 100 字的规范查询全称");
  const queryNameNormalized = normalizedCompanyName(queryName);
  if (!queryNameNormalized) throw new DomainError("查询全称不合法");
  const lockedAt = now();
  const owner = { id: leadId, contactStatus: "LOOKING_UP", contactStatusUpdatedAt: lockedAt };
  const lock = await db.lead.updateMany({ where: { id: leadId, OR: [
    { contactStatus: { in: ["PENDING_LOOKUP", "LOOKUP_FAILED"] } },
    { contactStatus: null, OR: [{ phone: null }, { phone: "" }] },
    { contactStatus: "LOOKING_UP", OR: [{ contactStatusUpdatedAt: { lt: new Date(lockedAt.getTime() - 120_000) } }, { contactStatusUpdatedAt: null }] },
  ] }, data: { contactStatus: "LOOKING_UP", contactStatusUpdatedAt: lockedAt } });
  if (!lock.count) throw new DomainError("该线索正在反查或状态不允许反查", 409);
  let lookupId: string | null = null;
  let charged = false;
  try {
    deps?.signal?.throwIfAborted();
    const cutoff = new Date(lockedAt.getTime() - lookupConfig().cacheDays * 86_400_000);
    const cached = await db.leadContactLookup.findFirst({ where: {
      queryNameNormalized, createdAt: { gte: cutoff }, isMock: false, cacheOfLookupId: null,
      status: { in: ["FOUND", "NEEDS_CONFIRM", "NOT_FOUND", "ADOPTED", "REJECTED"] },
    }, orderBy: { createdAt: "desc" } });
    const mock = leadRuntimeFlags().tycMockMode;
    if (!cached && !mock) {
      charged = await reserveLookupQuota(db, beijingQuotaDate(lockedAt), lookupConfig().limit);
      if (!charged) {
        await db.lead.updateMany({ where: owner, data: { contactStatus: original.contactStatus, contactStatusUpdatedAt: original.contactStatusUpdatedAt } });
        throw new DomainError("今日天眼查额度已用完（" + lookupConfig().limit + "/" + lookupConfig().limit + "）", 429);
      }
    }
    const record = await db.leadContactLookup.create({ data: {
      leadId, requestedById: user.id, queryName, queryNameNormalized, status: "RUNNING",
      reason: body.queryName ? "管理员指定查询名" : null, charged, isMock: mock && !cached, cacheOfLookupId: cached?.id ?? null,
    } });
    lookupId = record.id;
    const result = cached ? fromCache(cached) : await (deps?.client ?? createTianyanchaClient()).lookupCompany(queryName, deps?.signal);
    deps?.signal?.throwIfAborted();
    return await db.$transaction(async (tx) => {
      deps?.signal?.throwIfAborted();
      // 旧超时请求不得覆盖接手此线索的新请求。
      const ownership = await tx.lead.updateMany({ where: owner, data: { contactStatusUpdatedAt: lockedAt } });
      if (!ownership.count) throw new DomainError("反查已超时并被其他请求接管", 409);
      const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
      const outcome = classifyLookup(lead.companyName, result);
      const finishedAt = now();
      const row = await tx.leadContactLookup.update({ where: { id: record.id }, data: {
        status: outcome.status, reason: body.queryName ? "管理员指定查询名" + (outcome.reason ? "；" + outcome.reason : "") : outcome.reason, matchedName: result.companyName, tycCompanyId: result.tycCompanyId,
        creditCode: result.creditCode, regStatus: result.regStatus, phones: result.phones, emails: result.emails,
        rawResponse: result.raw as Prisma.InputJsonValue, isMock: result.isMock, finishedAt,
      } });
      const safeIdentity = !result.isMock && companyOperatingStatus(result.regStatus) === "ACTIVE" && matchCompanyIdentity(lead.companyName, result.companyName, result.historyNames) === "MATCH";
      if (outcome.status === "FOUND" || (outcome.status === "NOT_FOUND" && safeIdentity)) await applyContact(tx, user, lead, row.id, queryName, result, false, finishedAt);
      else await tx.lead.update({ where: { id: leadId }, data: { contactStatus: outcome.status === "NEEDS_CONFIRM" ? "NEEDS_CONFIRM" : "LOOKUP_FAILED", contactStatusUpdatedAt: finishedAt } });
      await writeOperationLog(tx, { userId: user.id, action: "LEAD_CONTACT_LOOKUP|result=" + outcome.status, entityType: "Lead", entityId: leadId, afterData: { lookupId: row.id, charged, isMock: result.isMock } });
      deps?.signal?.throwIfAborted();
      return { lookupId: row.id, ...outcome, isMock: result.isMock, charged };
    }, { maxWait: 2000, timeout: 5000 });
  } catch (error) {
    if (lookupId) {
      await db.$transaction(async (tx) => {
        await tx.leadContactLookup.updateMany({ where: { id: lookupId!, status: "RUNNING" }, data: { status: "FAILED", reason: "反查异常或超时，可重试", finishedAt: now() } });
        await tx.lead.updateMany({ where: owner, data: { contactStatus: "LOOKUP_FAILED", contactStatusUpdatedAt: now() } });
        await writeOperationLog(tx, { userId: user.id, action: "LEAD_CONTACT_LOOKUP|result=FAILED", entityType: "Lead", entityId: leadId, afterData: { lookupId, charged } });
      });
    }
    if (error instanceof DomainError) throw error;
    throw new DomainError("反查异常或超时，请重试", 502);
  } finally {
    await db.lead.updateMany({ where: owner, data: { contactStatus: "LOOKUP_FAILED", contactStatusUpdatedAt: now() } });
  }
}
export async function confirmLeadContact(user: SessionUser, lookupId: string, input: unknown, deps?: Deps) {
  requireContactAdmin(user);
  const decision = input && typeof input === "object" ? (input as Record<string, unknown>).decision : null;
  if (decision !== "ADOPT" && decision !== "REJECT") throw new DomainError("请选择采用或驳回");
  const db = deps?.prisma ?? defaultPrisma;
  const at = deps?.now?.() ?? new Date();
  return db.$transaction(async (tx) => {
    const row = await tx.leadContactLookup.findUnique({ where: { id: lookupId } });
    if (!row) throw new DomainError("反查记录不存在", 404);
    if (row.status !== "NEEDS_CONFIRM") throw new DomainError("该反查已处理", 409);
    if (row.isMock || companyOperatingStatus(row.regStatus) === "INACTIVE") throw new DomainError("模拟或停业注销结果不可采用", 409);
    const claimed = await tx.leadContactLookup.updateMany({ where: { id: lookupId, status: "NEEDS_CONFIRM" }, data: { status: decision === "ADOPT" ? "ADOPTED" : "REJECTED", confirmedById: user.id, confirmedAt: at } });
    if (!claimed.count) throw new DomainError("其他管理员已处理", 409);
    const lock = await tx.lead.updateMany({ where: { id: row.leadId, contactStatus: "NEEDS_CONFIRM" }, data: { contactStatus: "LOOKING_UP", contactStatusUpdatedAt: at } });
    if (!lock.count) throw new DomainError("线索状态已变化，请刷新", 409);
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: row.leadId } });
    if (decision === "ADOPT") await applyContact(tx, user, lead, row.id, row.queryName, fromCache(row), true, at);
    else await tx.lead.update({ where: { id: row.leadId }, data: { contactStatus: "LOOKUP_FAILED", contactStatusUpdatedAt: at } });
    await writeOperationLog(tx, { userId: user.id, action: "LEAD_CONTACT_CONFIRM|decision=" + decision, entityType: "Lead", entityId: row.leadId, afterData: { lookupId } });
    return { lookupId, decision };
  }, { maxWait: 2000, timeout: 5000 });
}
export async function listContactLookups(user: SessionUser, params: URLSearchParams, deps?: Deps) {
  requireContactAdmin(user);
  if (params.get("status") && params.get("status") !== "NEEDS_CONFIRM") throw new DomainError("status 不合法");
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const db = deps?.prisma ?? defaultPrisma;
  const where = { status: "NEEDS_CONFIRM" };
  const [items, total] = await Promise.all([
    db.leadContactLookup.findMany({ where, include: { lead: { select: { id: true, companyName: true, sourceUrl: true, aiScore: true } } }, orderBy: { createdAt: "desc" }, take: 20, skip: (page - 1) * 20 }),
    db.leadContactLookup.count({ where }),
  ]);
  return { items, pagination: { page, pageSize: 20, total, totalPages: Math.ceil(total / 20) } };
}
