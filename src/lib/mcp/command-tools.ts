import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import type {
  McpCommandContext,
  McpDataSource,
  McpServicePrincipal,
} from "@/lib/mcp/application";
import { createMcpToolErrorResult, McpToolError } from "@/lib/mcp/tools";
import { validateLeadProfileRegion } from "@/modules/crm/leads/lead-routing";

const optionalBoundedText = (maximum: number) => z.string().trim().min(1).max(maximum).optional();
const sensitiveProfileKey = /(?:prompt|secret|token|assertion|authorization|cookie|api[_-]?key|private[_-]?key)/iu;

const sourceUrl = z.string().max(2_048).refine((value) => {
  if (value !== value.trim()) return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}, { message: "sourceUrl 必须原样使用合法的 http 或 https URL" });

function containsSensitiveProfileKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveProfileKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => sensitiveProfileKey.test(key) || containsSensitiveProfileKey(nested));
}

const profile = z.record(z.string().min(1).max(64), z.unknown()).superRefine((value, context) => {
  if (JSON.stringify(value).length > 8_192) {
    context.addIssue({ code: "custom", message: "profile 序列化后不得超过 8192 字符" });
  }
  if (containsSensitiveProfileKey(value)) {
    context.addIssue({ code: "custom", message: "profile 不得包含提示词、密钥、断言或敏感请求头" });
  }
  if (validateLeadProfileRegion(value).status === "INVALID") {
    context.addIssue({
      code: "custom",
      path: ["province"],
      message: "profile.province/city 必须使用标准全称，且 city 必须属于 province",
    });
  }
});

export const leadWriteItemSchema = z.object({
  idempotencyKey: z.string().trim().min(16).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  companyName: z.string().trim().min(1).max(191),
  contactName: optionalBoundedText(191),
  phone: z.string().trim().min(7).max(32).regex(/^\+?[0-9][0-9 ()-]*$/).optional(),
  email: z.string().trim().max(191).email().optional(),
  source: z.enum(["BAIDU_SEARCH", "MANUAL", "OTHER"]),
  sourceUrl: sourceUrl.optional(),
  searchKeyword: optionalBoundedText(191),
  aiScore: z.number().int().min(0).max(100).optional(),
  profile: profile.optional(),
  sourceModelVersion: optionalBoundedText(191),
  extractorVersion: optionalBoundedText(191),
  sourceSystem: optionalBoundedText(191),
  externalLeadId: optionalBoundedText(191),
}).strict();

export const leadUpsertInputSchema = z.object({
  items: z.array(leadWriteItemSchema).min(1).max(20),
}).strict().superRefine((value, context) => {
  const keys = new Set<string>();
  value.items.forEach((item, index) => {
    if (keys.has(item.idempotencyKey)) {
      context.addIssue({ code: "custom", path: ["items", index, "idempotencyKey"], message: "同一批次不得重复 idempotencyKey" });
    }
    keys.add(item.idempotencyKey);
  });
});

export const MCP_COMMAND_TOOL_NAMES = ["lead_upsert"] as const;
export const MCP_COMMAND_TOOL_EFFECTS = { lead_upsert: "CREATE" } as const;

function plainJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, current) => typeof current === "bigint" ? current.toString() : current));
}

export function registerMcpCommandTools(
  server: McpServer,
  context: {
    requestId: string;
    principal: McpServicePrincipal | null;
    dataSource: McpDataSource;
    now: () => Date;
    allowedCommandToolNames?: readonly string[];
    allowedServicePrincipalIds?: readonly string[];
  },
) {
  const allowlist = new Set(context.allowedCommandToolNames ?? []);
  if (!allowlist.has("lead_upsert")) return;
  server.registerTool(
    "lead_upsert",
    {
      title: "幂等写入 AI 线索",
      description: "仅供内部 Lead 摄取服务幂等写入 AI 线索池；不会创建正式客户，销售归属只由服务端可信地域路由计算，调用方不能指定。",
      inputSchema: leadUpsertInputSchema,
      annotations: {
        title: "幂等写入 AI 线索",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: Record<string, unknown>) => {
      try {
        if (!context.principal || context.principal.principalType !== "SERVICE") {
          throw new McpToolError("SERVICE_IDENTITY_REQUIRED", "写工具仅允许服务身份调用");
        }
        if (!context.allowedServicePrincipalIds?.includes(context.principal.principalId)) {
          throw new McpToolError("SERVICE_PRINCIPAL_NOT_ALLOWED", "当前服务主体不在 Lead 写入白名单中");
        }
        if (!context.principal.scopes.includes("lead:create")) {
          throw new McpToolError("INSUFFICIENT_SCOPE", "服务身份缺少 lead:create 权限");
        }
        if (!context.dataSource.executeCommand) {
          throw new McpToolError("COMMAND_CHANNEL_UNAVAILABLE", "MCP 写入通道不可用");
        }
        const commandContext: McpCommandContext = {
          requestId: context.requestId,
          principal: context.principal,
        };
        const data = await context.dataSource.executeCommand("lead_upsert", args, commandContext);
        const envelope = {
          ok: true,
          data: plainJson(data),
          meta: { requestId: context.requestId, tool: "lead_upsert", generatedAt: context.now().toISOString() },
          error: null,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
          structuredContent: envelope,
        };
      } catch (error) {
        return createMcpToolErrorResult(context.requestId, "lead_upsert", context.now(), error);
      }
    },
  );
}
