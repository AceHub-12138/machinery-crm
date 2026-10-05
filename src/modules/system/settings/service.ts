import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/permissions";
import { DomainError } from "@/modules/shared/domain-error";
import { writeOperationLog } from "@/lib/sales-items";
import { assertAutoDocumentRules, DOCUMENT_NUMBER_RULES_KEY } from "@/lib/document-number";
import { normalizeAfterSalesPrintInfo, normalizeAfterSalesReminderConfig } from "@/lib/after-sales";
import { parseSalesScreenConfig, normalizeSalesScreenConfig, SALES_SCREEN_SETTING_KEY } from "@/modules/screen/config";

export const SETTINGS_ALLOWLIST = ["reminders", "printInfo", DOCUMENT_NUMBER_RULES_KEY, SALES_SCREEN_SETTING_KEY] as const;
export type SettingKey = (typeof SETTINGS_ALLOWLIST)[number];

function assertConfigAdmin(user: SessionUser) {
  if (user.role !== "SUPER_ADMIN") throw new DomainError("无权限访问配置中心", 403);
}

export async function listSettings(user: SessionUser) {
  assertConfigAdmin(user);
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTINGS_ALLOWLIST] } }, orderBy: { key: "asc" } });
  const normalizedItems = rows.map((row) => {
    if (row.key === SALES_SCREEN_SETTING_KEY) {
      return { ...row, value: normalizeSalesScreenConfig(row.value) };
    }
    return row;
  });
  return { items: normalizedItems, environment: { agentGateway: Boolean(process.env.NEXT_PUBLIC_AGENT_GATEWAY_URL), agentAppId: Boolean(process.env.NEXT_PUBLIC_AGENT_APP_ID) } };
}

export async function saveSetting(user: SessionUser, key: string, value: unknown) {
  assertConfigAdmin(user);
  if (!SETTINGS_ALLOWLIST.includes(key as SettingKey)) throw new DomainError("该配置项不允许编辑", 400);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("配置值必须是对象", 400);
  if (key === DOCUMENT_NUMBER_RULES_KEY) {
    try { value = assertAutoDocumentRules(value); } catch (error) { throw new DomainError(error instanceof Error ? error.message : "编号规则无效", 400); }
  }
  if (key === "reminders") value = normalizeAfterSalesReminderConfig(value);
  if (key === "printInfo") value = normalizeAfterSalesPrintInfo(value);
  if (key === SALES_SCREEN_SETTING_KEY) value = parseSalesScreenConfig(value);
  return prisma.$transaction(async (tx) => {
    const before = await tx.systemSetting.findUnique({ where: { key } });
    const row = await tx.systemSetting.upsert({ where: { key }, create: { key, value: value as object, updatedById: user.id }, update: { value: value as object, updatedById: user.id } });
    await writeOperationLog(tx, { userId: user.id, action: "UPDATE_SYSTEM_SETTING", entityType: "SystemSetting", entityId: key, beforeData: before?.value, afterData: row.value });
    return row;
  });
}
