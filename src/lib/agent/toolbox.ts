import { z } from "zod/v4";
import {
  MCP_TOOL_NAMES,
  getMcpBusinessToolDefinition,
  canCallMcpBusinessTool,
  type McpBusinessToolDefinition,
} from "@/lib/mcp/tools";
import type { McpRole } from "@/lib/mcp/application";
import {
  KNOWLEDGE_TOOL_DEFINITIONS,
  getKnowledgeToolDefinition,
  type KnowledgeToolDefinition,
} from "@/lib/agent/knowledge/tools";
import {
  CALCULATOR_TOOL_DEFINITIONS,
  getCalculatorToolDefinition,
  type CalculatorToolDefinition,
} from "@/lib/agent/tools/calculator";
import { getExternalMcpToolRegistry, type ExternalMcpToolRegistration } from "@/lib/agent/mcp-external";

/**
 * 小川（平台内 Agent）工具箱。
 *
 * 工具四类：
 * - MCP 业务只读工具：与 MCP 只读服务共用同一份定义与同一个执行器（prisma-data-source），
 *   执行前按用户当前角色做 canCallMcpBusinessTool 校验；
 * - 内置知识库工具（第 2 期）：机型能力参数 / 工艺规则 / 数控程序模板，不含业务敏感数据，全员可用；
 * - 内置计算工具（2026-09 一期）：表达式精确计算 / 毛坯重量估算，纯本地计算不触碰数据库，全员可用；
 * - 外部 MCP 工具（第 3 期）：智谱联网搜索/网页读取、天眼查、汇率查询等，启用即全员下发（含 Agent 账号），
 *   不接触平台数据库，业务隔离不受影响。
 * 每次执行都会写审计，审计失败不交付结果。
 */

const MCP_ALLOWED_TOOLS: readonly string[] = (MCP_TOOL_NAMES as readonly string[]).filter(
  (name) => name !== "dachuan_identity_who_am_i",
);

const KNOWLEDGE_ALLOWED_TOOLS: readonly string[] = KNOWLEDGE_TOOL_DEFINITIONS.map((definition) => definition.name);

const CALCULATOR_ALLOWED_TOOLS: readonly string[] = CALCULATOR_TOOL_DEFINITIONS.map((definition) => definition.name);

export const XIAOCHUAN_ALLOWED_TOOLS: readonly string[] = [
  ...MCP_ALLOWED_TOOLS,
  ...KNOWLEDGE_ALLOWED_TOOLS,
  ...CALCULATOR_ALLOWED_TOOLS,
];

export type XiaochuanToolSpec = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type BuiltinToolDefinition = KnowledgeToolDefinition | CalculatorToolDefinition;

function toOpenAiParameters(schema: BuiltinToolDefinition["schema"] | McpBusinessToolDefinition["schema"]): Record<string, unknown> {
  // OpenAI 兼容接口不接受顶层 $schema 键
  const parameters: Record<string, unknown> = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete parameters.$schema;
  return parameters;
}

/** 按用户当前角色生成大脑可见的工具清单：角色无权的业务工具不下发；知识库/计算工具全员下发。 */
export function buildXiaochuanToolSpecs(role: McpRole): XiaochuanToolSpec[] {
  const specs: XiaochuanToolSpec[] = [];
  for (const name of MCP_ALLOWED_TOOLS) {
    if (!canCallMcpBusinessTool(name, role)) continue;
    const definition = getMcpBusinessToolDefinition(name);
    if (!definition) continue;
    specs.push({
      type: "function",
      function: {
        name: definition.name,
        description: definition.description,
        parameters: toOpenAiParameters(definition.schema),
      },
    });
  }
  for (const definition of [...KNOWLEDGE_TOOL_DEFINITIONS, ...CALCULATOR_TOOL_DEFINITIONS]) {
    specs.push({
      type: "function",
      function: {
        name: definition.name,
        description: definition.description,
        parameters: toOpenAiParameters(definition.schema),
      },
    });
  }
  return specs;
}

export function getXiaochuanToolSchema(name: string): BuiltinToolDefinition["schema"] | McpBusinessToolDefinition["schema"] | null {
  if (!XIAOCHUAN_ALLOWED_TOOLS.includes(name)) return null;
  return (
    getKnowledgeToolDefinition(name)?.schema ??
    getCalculatorToolDefinition(name)?.schema ??
    getMcpBusinessToolDefinition(name)?.schema ??
    null
  );
}

export type XiaochuanFullToolSpecs = {
  specs: XiaochuanToolSpec[];
  /** 大脑本回合可用的全部工具名（内置白名单 + 外部注册表），引擎用它过滤工单 */
  allowedNames: readonly string[];
  externalRegistrations: ExternalMcpToolRegistration[];
  /** 是否有外部工具可用（提示词据此注入联网工具说明） */
  hasExternalTools: boolean;
};

/**
 * 完整工具清单 = 内置（按角色过滤）+ 外部 MCP（全员）。
 * 外部注册表读取/连接失败时自动降级为纯内置工具，不阻塞对话。
 */
export async function buildXiaochuanFullToolSpecs(role: McpRole): Promise<XiaochuanFullToolSpecs> {
  const specs = buildXiaochuanToolSpecs(role);
  // 允许范围 = 全量内置白名单 + 外部工具：角色无权的内置工具仍进引擎（执行时由 executor
  // FORBIDDEN 并审计，保持"越权调用留痕"纪律），只是不下发给大脑；
  // 白名单外才在引擎层直接拒绝。
  const allowedNames: string[] = [...XIAOCHUAN_ALLOWED_TOOLS];
  let externalRegistrations: ExternalMcpToolRegistration[] = [];
  try {
    const registry = await getExternalMcpToolRegistry();
    externalRegistrations = registry.registrations;
  } catch (error) {
    console.error("[toolbox] 外部 MCP 注册表读取失败，本轮仅用内置工具:", error);
  }
  for (const registration of externalRegistrations) {
    allowedNames.push(registration.exposedName);
    specs.push({
      type: "function",
      function: {
        name: registration.exposedName,
        description: registration.description || `外部工具（${registration.serverName}）`,
        parameters: registration.inputSchema,
      },
    });
  }
  return { specs, allowedNames, externalRegistrations, hasExternalTools: externalRegistrations.length > 0 };
}
