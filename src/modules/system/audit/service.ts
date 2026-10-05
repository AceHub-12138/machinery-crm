import { prisma } from "@/lib/db";
import { isSuperAdmin, type SessionUser } from "@/lib/permissions";
import { DomainError } from "@/modules/shared/domain-error";

/** 兼容阶段的审计读取服务。分页、脱敏和对象级范围将在阶段 3 扩展。 */
export async function listOperationLogs(user: SessionUser, searchParams: URLSearchParams) {
  if (!isSuperAdmin(user)) throw new DomainError("无权查看操作日志", 403);
  const action = searchParams.get("action") || "";
  const entityType = searchParams.get("entityType") || "";
  const pageSize = Math.min(Number(searchParams.get("pageSize") || 100), 200);
  const where: { action?: string; entityType?: string } = {};
  if (action) where.action = action;
  if (entityType) where.entityType = entityType;
  return prisma.operationLog.findMany({
    where,
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: pageSize,
  });
}

const SENSITIVE_KEY = /^(password|passwordHash|token|cookie|authorization|apiKey|secret|privateKey|DATABASE_URL|connectionString)$/i;
export function redactAuditData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditData);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "***" : redactAuditData(item)]));
  return value;
}

/** 阶段 3 新审计入口：分页、筛选、递归脱敏；旧 /api/operation-logs 保持数组契约。 */
export async function searchAuditLogs(user: SessionUser, searchParams: URLSearchParams) {
  if (!isSuperAdmin(user)) throw new DomainError("无权查看操作日志", 403);
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") || 30)));
  const action = searchParams.get("action") || undefined;
  const entityType = searchParams.get("entityType") || undefined;
  const userId = searchParams.get("userId") || undefined;
  const keyword = searchParams.get("keyword")?.trim() || undefined;
  const from = searchParams.get("from") ? new Date(`${searchParams.get("from")}T00:00:00`) : undefined;
  const to = searchParams.get("to") ? new Date(`${searchParams.get("to")}T23:59:59.999`) : undefined;
  const where = { ...(action ? { action } : {}), ...(entityType ? { entityType } : {}), ...(userId ? { userId } : {}), ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}), ...(keyword ? { OR: [{ entityId: { contains: keyword } }, { action: { contains: keyword } }, { entityType: { contains: keyword } }] } : {}) };
  const [rows, total] = await Promise.all([prisma.operationLog.findMany({ where, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }), prisma.operationLog.count({ where })]);
  return { items: rows.map((row) => ({ ...row, beforeData: redactAuditData(row.beforeData), afterData: redactAuditData(row.afterData) })), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}
