import { randomUUID } from "node:crypto";
import {
  canCallMcpBusinessTool,
  getMcpBusinessToolDefinition,
  McpToolError,
} from "@/lib/mcp/tools";
import type { McpDataSource, McpUser } from "@/lib/mcp/application";
import { getKnowledgeToolDefinition } from "@/lib/agent/knowledge/tools";
import { runKnowledgeTool } from "@/lib/agent/knowledge/queries";
import { getCalculatorToolDefinition, runCalculatorTool } from "@/lib/agent/tools/calculator";
import { callExternalMcpTool, type ExternalMcpToolRegistration } from "@/lib/agent/mcp-external";
import { prisma } from "@/lib/db";

/**
 * 小川执行器：大脑（LLM）每次决定调用工具时，由这里代为执行。
 *
 * 安全边界：
 * 1. 只允许工具箱白名单内的只读工具（MCP 业务工具 + 内置知识库工具）；
 * 2. 每次执行前按用户当前数据库角色再做一次角色校验（与 MCP 同一函数；知识库全员可用）；
 * 3. 参数用与 MCP 相同的 Zod schema 严格解析；
 * 4. 业务工具走 MCP 同一个 dataSource.execute（数据范围下推复用），知识工具只读知识库表；
 * 5. 每次调用写入 OperationLog 审计；审计失败时不交付查询结果。
 */

export const XIAOCHUAN_AUDIT_API_KEY_NAME = "xiaochuan-in-app";
export const XIAOCHUAN_AUDIT_METHOD = "agent_tool_call";

export type AgentToolOutcome = {
  tool: string;
  ok: boolean;
  durationMs: number;
  /** 成功时的查询结果（bigint 已转字符串） */
  data?: unknown;
  /** 失败时的错误码与给模型看的中文说明 */
  errorCode?: string;
  message?: string;
};

function plainJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, current) => (typeof current === "bigint" ? current.toString() : current)));
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
}

function extractIssueMessage(error: unknown) {
  if (error && typeof error === "object" && "issues" in error) {
    return (error as { issues: Array<{ path: Array<string | number>; message: string }> }).issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("；");
  }
  return "";
}

/** 知识工具的执行入口，测试可注入 mock（默认走真实知识库查询） */
export type KnowledgeToolRunner = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;

/** 计算工具的执行入口，测试可注入 mock（默认走本地计算） */
export type CalculatorToolRunner = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;

export async function executeAgentTool(options: {
  dataSource: McpDataSource;
  user: McpUser;
  toolName: string;
  args: Record<string, unknown>;
  timeoutMs?: number;
  knowledgeRunner?: KnowledgeToolRunner;
  calculatorRunner?: CalculatorToolRunner;
  // Agent 独立账号身份时必传：审计写入 agent_account_audit_logs（独立表，避免触碰带 users 外键的既有审计表）
  agentAccountId?: string;
  // 本回合可用的外部 MCP 工具注册表（engine 从工具箱带入）；外部工具对全员开放，不触碰平台数据库
  externalRegistrations?: ExternalMcpToolRegistration[];
}): Promise<AgentToolOutcome> {
  const { dataSource, user, toolName, args } = options;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const requestId = randomUUID();
  const startedAt = Date.now();

  const finish = async (
    build: (durationMs: number) => Omit<AgentToolOutcome, "tool" | "durationMs"> & { statusCode: number },
  ): Promise<AgentToolOutcome> => {
    const durationMs = Date.now() - startedAt;
    const outcome = build(durationMs);
    try {
      if (options.agentAccountId) {
        await prisma.agentAccountAuditLog.create({
          data: {
            agentAccountId: options.agentAccountId,
            requestId,
            toolName,
            success: outcome.ok,
            statusCode: outcome.statusCode,
            durationMs,
            rejectionReason: outcome.ok ? null : outcome.errorCode ?? null,
          },
        });
      } else {
        await dataSource.writeAudit({
          requestId,
          userId: user.id,
          apiKeyName: XIAOCHUAN_AUDIT_API_KEY_NAME,
          method: XIAOCHUAN_AUDIT_METHOD,
          toolName,
          success: outcome.ok,
          statusCode: outcome.statusCode,
          durationMs,
          createdAt: new Date(),
          rejectionReason: outcome.ok ? undefined : outcome.errorCode,
        });
      }
    } catch {
      // 与 MCP 同一纪律：审计不可用时不得交付查询结果
      return { tool: toolName, ok: false, durationMs, errorCode: "AUDIT_UNAVAILABLE", message: "操作日志暂不可用，已取消本次查询" };
    }
    const { statusCode: _statusCode, ...rest } = outcome;
    return { tool: toolName, durationMs, ...rest };
  };

  const calculatorDefinition = getCalculatorToolDefinition(toolName);
  const knowledgeDefinition = calculatorDefinition ? null : getKnowledgeToolDefinition(toolName);
  const mcpDefinition = knowledgeDefinition ? null : getMcpBusinessToolDefinition(toolName);
  const externalRegistration = knowledgeDefinition || mcpDefinition || calculatorDefinition
    ? null
    : options.externalRegistrations?.find((registration) => registration.exposedName === toolName) ?? null;
  if (!calculatorDefinition && !knowledgeDefinition && !mcpDefinition && !externalRegistration) {
    return finish((durationMs) => ({
      ok: false, durationMs, statusCode: 403,
      errorCode: "TOOL_NOT_ALLOWED", message: `工具 ${toolName} 不在小川的工具箱白名单内`,
    }));
  }

  // 外部 MCP 工具（联网搜索/网页读取/天眼查/汇率等）：全员可用、不触碰平台数据库；
  // 参数是大脑给的对象（schema 由服务端透传），执行超时比内置工具更长（联网搜索较慢），审计纪律一致。
  if (externalRegistration) {
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      return finish((durationMs) => ({
        ok: false, durationMs, statusCode: 400,
        errorCode: "INVALID_ARGUMENT", message: "外部工具参数必须是对象",
      }));
    }
    try {
      const data = await callExternalMcpTool(externalRegistration, args, 20_000);
      return finish((durationMs) => ({ ok: true, durationMs, statusCode: 200, data: plainJson(data) }));
    } catch (error) {
      const isMcpError = error instanceof McpToolError;
      return finish((durationMs) => ({
        ok: false, durationMs, statusCode: 502,
        errorCode: isMcpError ? error.code : "EXTERNAL_MCP_UNAVAILABLE",
        message: isMcpError ? error.message : "外部工具暂时联系不上，请稍后再试",
      }));
    }
  }

  // 内置计算工具（2026-09 一期）：纯本地计算、不触碰数据库、全员可用；
  // 参数校验、执行超时、审计纪律与知识库工具完全一致。
  if (calculatorDefinition) {
    let parsedCalcArgs: Record<string, unknown>;
    try {
      parsedCalcArgs = calculatorDefinition.schema.parse(args) as Record<string, unknown>;
    } catch (error) {
      return finish((durationMs) => ({
        ok: false, durationMs, statusCode: 400,
        errorCode: "INVALID_ARGUMENT", message: truncate(`工具参数无效。${extractIssueMessage(error)}`, 300),
      }));
    }
    try {
      const runner = options.calculatorRunner ?? runCalculatorTool;
      const data = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new McpToolError("QUERY_TIMEOUT", "计算超过允许等待时间")), timeoutMs);
        runner(toolName, parsedCalcArgs).then(resolve, reject).finally(() => clearTimeout(timer));
      });
      return finish((durationMs) => ({ ok: true, durationMs, statusCode: 200, data: plainJson(data) }));
    } catch (error) {
      const isMcpError = error instanceof McpToolError;
      return finish((durationMs) => ({
        ok: false, durationMs, statusCode: isMcpError ? 400 : 500,
        errorCode: isMcpError ? error.code : "INTERNAL_ERROR",
        message: isMcpError ? error.message : "计算失败",
      }));
    }
  }

  // 内置知识库工具：知识库不含业务敏感数据，全员可用（拍板：对话全员可用，知识库同域）；
  // 但参数校验、执行超时、审计纪律与 MCP 业务工具完全一致。
  if (knowledgeDefinition) {
    let parsedKnowledgeArgs: Record<string, unknown>;
    try {
      parsedKnowledgeArgs = knowledgeDefinition.schema.parse(args) as Record<string, unknown>;
    } catch (error) {
      return finish((durationMs) => ({
        ok: false, durationMs, statusCode: 400,
        errorCode: "INVALID_ARGUMENT", message: truncate(`工具参数无效。${extractIssueMessage(error)}`, 300),
      }));
    }
    try {
      const runner = options.knowledgeRunner ?? runKnowledgeTool;
      const data = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new McpToolError("QUERY_TIMEOUT", "查询超过允许等待时间")), timeoutMs);
        runner(toolName, parsedKnowledgeArgs).then(resolve, reject).finally(() => clearTimeout(timer));
      });
      return finish((durationMs) => ({ ok: true, durationMs, statusCode: 200, data: plainJson(data) }));
    } catch (error) {
      const isMcpError = error instanceof McpToolError;
      return finish((durationMs) => ({
        ok: false, durationMs, statusCode: 500,
        errorCode: isMcpError ? error.code : "INTERNAL_ERROR",
        message: isMcpError ? error.message : "知识库查询失败",
      }));
    }
  }

  if (!canCallMcpBusinessTool(toolName, user.role)) {
    return finish((durationMs) => ({
      ok: false, durationMs, statusCode: 403,
      errorCode: "FORBIDDEN", message: "当前角色无权使用此工具",
    }));
  }

  let parsedArgs: Record<string, unknown>;
  try {
    parsedArgs = mcpDefinition!.schema.parse(args) as Record<string, unknown>;
  } catch (error) {
    return finish((durationMs) => ({
      ok: false, durationMs, statusCode: 400,
      errorCode: "INVALID_ARGUMENT", message: truncate(`工具参数无效。${extractIssueMessage(error)}`, 300),
    }));
  }

  try {
    const data = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new McpToolError("QUERY_TIMEOUT", "查询超过允许等待时间")), timeoutMs);
      dataSource.execute(toolName, parsedArgs, user).then(resolve, reject).finally(() => clearTimeout(timer));
    });
    return finish((durationMs) => ({ ok: true, durationMs, statusCode: 200, data: plainJson(data) }));
  } catch (error) {
    const isMcpError = error instanceof McpToolError;
    return finish((durationMs) => ({
      ok: false, durationMs, statusCode: 500,
      errorCode: isMcpError ? error.code : "INTERNAL_ERROR",
      message: isMcpError ? error.message : "工具执行失败",
    }));
  }
}
