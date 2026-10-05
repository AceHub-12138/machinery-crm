import { createHash, randomUUID } from "node:crypto";
import type { Lead, Prisma, PrismaClient } from "@prisma/client";
import type { McpCommandContext, McpDataSource } from "@/lib/mcp/application";
import { leadUpsertInputSchema } from "@/lib/mcp/command-tools";
import { McpToolError } from "@/lib/mcp/tools";
import {
  leadRoutingAuditAction,
  leadRoutingOutcome,
  resolveLeadAssignee,
  routingUnavailable,
  type LeadRoutingOutcome,
  type LeadRoutingResult,
} from "@/modules/crm/leads/lead-routing";

type LeadWriteItem = ReturnType<typeof leadUpsertInputSchema.parse>["items"][number];
type LeadHashPayload = Omit<LeadWriteItem, "idempotencyKey" | "payloadHash">;
function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, stableJsonValue(nested)]));
}

function normalizedPayload(payload: LeadHashPayload) {
  return Object.fromEntries(Object.entries(payload)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, stableJsonValue(value)]));
}

export function canonicalLeadPayloadHash(payload: LeadHashPayload) {
  return createHash("sha256").update(JSON.stringify(normalizedPayload(payload))).digest("hex");
}

function normalizedCompanyName(companyName: string) {
  return companyName.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function dedupFingerprint(item: LeadWriteItem) {
  const company = normalizedCompanyName(item.companyName);
  return createHash("sha256").update(`lead-company-v1|${company}`).digest("hex");
}

function emptyText(value: string | null | undefined) {
  return !value?.trim();
}

const SEARCH_KEYWORD_SEPARATOR = "；";
const SEARCH_KEYWORD_MAX_LENGTH = 191;

function keywordIdentity(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function mergedSearchKeyword(existing: string | null, incoming: string | undefined) {
  if (!incoming) return existing;
  if (emptyText(existing)) return incoming;
  const identities = new Set(existing!.split(SEARCH_KEYWORD_SEPARATOR).map(keywordIdentity));
  if (identities.has(keywordIdentity(incoming))) return existing;
  const merged = `${existing}${SEARCH_KEYWORD_SEPARATOR}${incoming}`;
  return merged.length <= SEARCH_KEYWORD_MAX_LENGTH ? merged : existing;
}

function mergedLeadData(existing: Lead, item: LeadWriteItem): Prisma.LeadUncheckedUpdateInput {
  const data: Prisma.LeadUncheckedUpdateInput = {};
  if (emptyText(existing.contactName) && item.contactName) data.contactName = item.contactName;
  if (emptyText(existing.phone) && item.phone) data.phone = item.phone;
  if (emptyText(existing.email) && item.email) data.email = item.email;
  if (emptyText(existing.sourceUrl) && item.sourceUrl) data.sourceUrl = item.sourceUrl;
  if (item.aiScore !== undefined) data.aiScore = item.aiScore;
  if (item.profile !== undefined) data.profile = stableJsonValue(item.profile) as Prisma.InputJsonValue;
  if (item.sourceModelVersion !== undefined) data.sourceModelVersion = item.sourceModelVersion;
  if (item.extractorVersion !== undefined) data.extractorVersion = item.extractorVersion;
  const searchKeyword = mergedSearchKeyword(existing.searchKeyword, item.searchKeyword);
  if (searchKeyword !== existing.searchKeyword) data.searchKeyword = searchKeyword;
  return data;
}

type LeadWriteDisposition = "CREATED" | "MERGED" | "REPLAY";

function publicLead(
  lead: Lead,
  writeDisposition: LeadWriteDisposition,
  routingOutcome: LeadRoutingOutcome | null,
) {
  return {
    id: lead.id,
    companyName: lead.companyName,
    source: lead.source,
    aiScore: lead.aiScore ?? null,
    dedupStatus: lead.dedupStatus,
    duplicateOfLeadId: lead.duplicateOfLeadId,
    duplicateConfidence: lead.duplicateConfidence,
    createdAt: lead.createdAt ?? null,
    replay: writeDisposition === "REPLAY",
    writeDisposition,
    routingOutcome,
  };
}

function isRetryableWriteRace(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error.code === "P2002" || error.code === "P2034"),
  );
}

async function audit(
  transaction: Prisma.TransactionClient,
  context: McpCommandContext,
  item: LeadWriteItem,
  outcome: "CREATED" | "REPLAY" | "CONFLICT",
  entityId: string | null,
  action = "LEAD_UPSERT",
  routingOutcome: LeadRoutingOutcome | null = null,
) {
  await transaction.$executeRaw`
    INSERT INTO lead_write_audits
      (id, principalType, principalId, action, entityType, entityId, idempotencyKey, outcome, routingOutcome, payloadHash, requestId, createdAt)
    VALUES
      (${randomUUID()}, ${context.principal.principalType}, ${context.principal.principalId}, ${action}, ${"Lead"}, ${entityId}, ${item.idempotencyKey}, ${outcome}, ${routingOutcome}, ${item.payloadHash}, ${context.requestId}, UTC_TIMESTAMP(3))
  `;
}

async function resolveAutoAssignment(
  transaction: Prisma.TransactionClient,
  item: LeadWriteItem,
): Promise<LeadRoutingResult> {
  const unresolved = resolveLeadAssignee(item.profile, []);
  if (unresolved.reason === "REGION_UNRESOLVED") return unresolved;
  try {
    const candidates = await transaction.user.findMany({
      where: { isActive: true, role: { in: ["SALES", "FOREIGN_TRADE"] } },
      select: { id: true, role: true, isActive: true, territories: true },
    });
    return resolveLeadAssignee(item.profile, candidates);
  } catch {
    return routingUnavailable(item.profile);
  }
}

async function knownWrite(
  transaction: Prisma.TransactionClient,
  idempotencyKey: string,
): Promise<{ lead: Lead; payloadHash: string; receiptExists: boolean } | null> {
  const receipt = await transaction.leadWriteIdempotency.findUnique({ where: { idempotencyKey } });
  if (receipt) {
    const lead = await transaction.lead.findUnique({ where: { id: receipt.leadId } });
    if (!lead) throw new McpToolError("LEAD_WRITE_INTEGRITY_ERROR", "幂等回执关联的 Lead 不存在");
    return { lead, payloadHash: receipt.payloadHash, receiptExists: true };
  }
  const legacyLead = await transaction.lead.findUnique({ where: { idempotencyKey } });
  if (!legacyLead) return null;
  return { lead: legacyLead, payloadHash: legacyLead.payloadHash ?? "", receiptExists: false };
}

async function createIdempotencyReceipt(
  transaction: Prisma.TransactionClient,
  item: LeadWriteItem,
  leadId: string,
) {
  await transaction.leadWriteIdempotency.create({
    data: { idempotencyKey: item.idempotencyKey, payloadHash: item.payloadHash, leadId },
  });
}

async function companyLead(
  transaction: Prisma.TransactionClient,
  item: LeadWriteItem,
  dedupKey: string,
  legacyCompanyIndex: { value: Map<string, Lead> | null },
) {
  const current = await transaction.lead.findUnique({ where: { dedupKey } });
  if (current) return current;
  if (!legacyCompanyIndex.value) {
    // 升级兼容固定选择规则：历史 root 优先；同层级再按 createdAt、id 选择最早记录。
    // 这样即使 PENDING_REVIEW duplicate 的时间更早，也不会把后续写入合并到 duplicate。
    const ordered = (await transaction.lead.findMany()).sort((left, right) => {
      const duplicateOrder = Number(Boolean(left.duplicateOfLeadId)) - Number(Boolean(right.duplicateOfLeadId));
      if (duplicateOrder !== 0) return duplicateOrder;
      const createdOrder = left.createdAt.getTime() - right.createdAt.getTime();
      return createdOrder !== 0 ? createdOrder : left.id.localeCompare(right.id);
    });
    legacyCompanyIndex.value = new Map<string, Lead>();
    for (const lead of ordered) {
      const normalized = normalizedCompanyName(lead.companyName);
      if (normalized && !legacyCompanyIndex.value.has(normalized)) legacyCompanyIndex.value.set(normalized, lead);
    }
  }
  return legacyCompanyIndex.value.get(normalizedCompanyName(item.companyName)) ?? null;
}

async function lockedLead(transaction: Prisma.TransactionClient, leadId: string) {
  const rows = await transaction.$queryRaw<Lead[]>`
    SELECT * FROM leads WHERE id = ${leadId} FOR UPDATE
  `;
  const lead = rows[0];
  if (!lead) throw new McpToolError("LEAD_WRITE_INTEGRITY_ERROR", "待合并的 Lead 不存在");
  return lead;
}

export function createPrismaLeadCommandDataSource(client: PrismaClient): {
  executeCommand: NonNullable<McpDataSource["executeCommand"]>;
} {
  return {
    async executeCommand(toolName, args, context) {
      if (toolName !== "lead_upsert") throw new McpToolError("UNKNOWN_TOOL", "未知或未启用的 MCP 写工具");
      if (
        context.principal.principalType !== "SERVICE"
        || !context.principal.scopes.includes("lead:create")
      ) {
        throw new McpToolError("FORBIDDEN", "当前服务身份无权执行 Lead 写入");
      }
      const parsed = leadUpsertInputSchema.safeParse(args);
      if (!parsed.success) throw new McpToolError("INVALID_ARGUMENT", "Lead 写入参数无效");
      for (const item of parsed.data.items) {
        if (!normalizedCompanyName(item.companyName)) {
          throw new McpToolError("INVALID_ARGUMENT", "companyName 规范化后不能为空");
        }
        const payload = Object.fromEntries(Object.entries(item)
          .filter(([key]) => !["idempotencyKey", "payloadHash"].includes(key))) as LeadHashPayload;
        if (canonicalLeadPayloadHash(payload) !== item.payloadHash) {
          throw new McpToolError("PAYLOAD_HASH_MISMATCH", "payloadHash 与规范化业务字段不一致");
        }
      }

      const runTransaction = () => client.$transaction(async (transaction) => {
          const results: Array<ReturnType<typeof publicLead>> = [];
          const legacyCompanyIndex: { value: Map<string, Lead> | null } = { value: null };
          const existingByKey = new Map<string, { lead: Lead; payloadHash: string; receiptExists: boolean }>();
          const conflictingKeys = new Set<string>();
          for (const item of parsed.data.items) {
            const existing = await knownWrite(transaction, item.idempotencyKey);
            if (!existing) continue;
            existingByKey.set(item.idempotencyKey, existing);
            if (existing.payloadHash !== item.payloadHash) {
              conflictingKeys.add(item.idempotencyKey);
            }
          }
          if (conflictingKeys.size > 0) {
            for (const item of parsed.data.items) {
              const existing = existingByKey.get(item.idempotencyKey);
              if (!existing) continue;
              await audit(
                transaction,
                context,
                item,
                conflictingKeys.has(item.idempotencyKey) ? "CONFLICT" : "REPLAY",
                existing.lead.id,
              );
            }
            return { conflict: conflictingKeys.values().next().value ?? null, results: [] };
          }
          for (const item of parsed.data.items) {
            const existing = existingByKey.get(item.idempotencyKey);
            if (existing) {
              if (!existing.receiptExists) await createIdempotencyReceipt(transaction, item, existing.lead.id);
              await audit(transaction, context, item, "REPLAY", existing.lead.id);
              results.push(publicLead(existing.lead, "REPLAY", null));
              continue;
            }

            const dedupKey = dedupFingerprint(item);
            const duplicateCandidate = await companyLead(transaction, item, dedupKey, legacyCompanyIndex);
            const duplicate = duplicateCandidate ? await lockedLead(transaction, duplicateCandidate.id) : null;
            const mergeData = duplicate ? mergedLeadData(duplicate, item) : null;
            const routing = duplicate ? null : await resolveAutoAssignment(transaction, item);
            // dedupKey UPDATE 只用于把旧 company+phone+email 指纹惰性迁移为 company-only 指纹。
            if (duplicate && duplicate.dedupKey !== dedupKey) mergeData!.dedupKey = dedupKey;
            const lead = duplicate
              ? await transaction.lead.update({ where: { id: duplicate.id }, data: mergeData! })
              : await transaction.lead.create({
                  data: {
                    ...normalizedPayload(Object.fromEntries(Object.entries(item).filter(([key]) => !["idempotencyKey", "payloadHash"].includes(key))) as LeadHashPayload),
                    idempotencyKey: item.idempotencyKey,
                    payloadHash: item.payloadHash,
                    dedupKey,
                    duplicateOfLeadId: null,
                    duplicateConfidence: null,
                    dedupStatus: "UNIQUE",
                    assignedUserId: routing?.assignedUserId ?? null,
                  } as Prisma.LeadUncheckedCreateInput,
                });
            await createIdempotencyReceipt(transaction, item, lead.id);
            await audit(
              transaction,
              context,
              item,
              "CREATED",
              lead.id,
              routing ? leadRoutingAuditAction(routing) : "LEAD_UPSERT",
              routing ? leadRoutingOutcome(routing) : null,
            );
            results.push(publicLead(
              lead,
              duplicate ? "MERGED" : "CREATED",
              routing ? leadRoutingOutcome(routing) : null,
            ));
          }
          return { conflict: null, results };
        });
      let transactionResult: Awaited<ReturnType<typeof runTransaction>> | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          transactionResult = await runTransaction();
          break;
        } catch (error) {
          if (!isRetryableWriteRace(error) || attempt === 2) throw error;
        }
      }
      if (!transactionResult) throw new McpToolError("WRITE_CONFLICT_RETRY_EXHAUSTED", "Lead 写入并发重试失败");

      if (transactionResult.conflict) {
        throw new McpToolError("IDEMPOTENCY_CONFLICT", "同一 idempotencyKey 对应了不同 payloadHash");
      }
      return { items: transactionResult.results };
    },
  };
}
