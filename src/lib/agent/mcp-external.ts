import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { prisma } from "@/lib/db";
import { decryptApiKey } from "@/lib/agent/model-config-store";

/**
 * 外部 MCP 对接器（第 3 期 B 段）：把智谱联网搜索、网页读取等 Remote MCP 服务
 * 挂进小川工具箱。设计要点：
 * - 配置存 agent_mcp_servers 表（Agent 管理·外部 MCP 标签页维护），URL 支持 {API_KEY} 占位符，
 *   连接时同时附加 Authorization: Bearer 头（两种鉴权习惯都兼容）；
 * - 启用的服务对全员下发（含 Agent 独立账号）——这是"Agent 账号不能查业务数据、
 *   但可以享受外部工具"的关键路径；业务隔离不受影响（外部工具不碰平台数据库）；
 * - 工具名暴露给大脑时统一加 mcp_ 前缀并做合法化（OpenAI function name 仅允许字母数字-_），
 *   执行时经注册表路由回「原服务·原工具名」；与内置工具重名时跳过该外部工具并记日志；
 * - 连接与工具清单均做进程内缓存；单个服务失联只降级自身，绝不阻塞小川其余工具。
 */

export const EXTERNAL_TOOL_NAME_PREFIX = "mcp_";

export type ExternalMcpToolRegistration = {
  exposedName: string;
  serverId: string;
  serverName: string;
  originalName: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type ServerRuntime = {
  serverId: string;
  serverName: string;
  client: Client;
};

type RegistryCache = {
  registrations: ExternalMcpToolRegistration[];
  byExposedName: Map<string, ExternalMcpToolRegistration>;
  runtimes: Map<string, ServerRuntime>;
  fetchedAt: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000;

const globalCache = globalThis as unknown as { __xiaochuanExternalMcpCache?: RegistryCache };

function cache(): RegistryCache {
  if (!globalCache.__xiaochuanExternalMcpCache) {
    globalCache.__xiaochuanExternalMcpCache = {
      registrations: [],
      byExposedName: new Map(),
      runtimes: new Map(),
      fetchedAt: 0,
    };
  }
  return globalCache.__xiaochuanExternalMcpCache;
}

export function clearExternalMcpCache() {
  const current = globalCache.__xiaochuanExternalMcpCache;
  if (current) {
    for (const runtime of current.runtimes.values()) {
      void runtime.client.close().catch(() => undefined);
    }
  }
  globalCache.__xiaochuanExternalMcpCache = undefined;
}

/** OpenAI function name 规范化：仅 [a-zA-Z0-9_-]，加 mcp_ 前缀，超长截断 */
export function sanitizeExternalToolName(originalName: string) {
  const cleaned = originalName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const prefixed = `${EXTERNAL_TOOL_NAME_PREFIX}${cleaned}`;
  return prefixed.slice(0, 64);
}

/** URL 中的 {API_KEY} 占位符替换；没有 Key 时把带占位符的 URL 视为未配置 */
export function resolveServerUrl(url: string, apiKey: string | null): string {
  if (url.includes("{API_KEY}")) {
    if (!apiKey) throw new Error(`MCP 服务地址包含 {API_KEY} 占位符但未配置 API Key`);
    return url.replaceAll("{API_KEY}", encodeURIComponent(apiKey));
  }
  return url;
}

async function connectServer(serverId: string, serverName: string, url: string, apiKey: string | null): Promise<ServerRuntime> {
  const client = new Client({ name: "dachuan-xiaochuan", version: "1.0.0" });
  const headers: Record<string, string> = {};
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers },
  });
  await client.connect(transport);
  return { serverId, serverName, client };
}

async function fetchEnabledServers() {
  const rows = await prisma.agentMcpServer.findMany({ where: { isEnabled: true }, orderBy: { createdAt: "asc" } });
  return rows.map((row) => {
    const apiKey = row.apiKeyCipher ? decryptApiKey(row.apiKeyCipher) : null;
    return { serverId: row.id, serverName: row.name, url: resolveServerUrl(row.url, apiKey), apiKey };
  });
}

/** 拉取全部启用服务的外部工具注册表（进程内缓存 5 分钟；失败的服务跳过并记日志） */
export async function getExternalMcpToolRegistry(forceRefresh = false): Promise<{
  registrations: ExternalMcpToolRegistration[];
  byExposedName: Map<string, ExternalMcpToolRegistration>;
}> {
  const current = cache();
  if (!forceRefresh && current.fetchedAt && Date.now() - current.fetchedAt < CACHE_TTL_MS) {
    return { registrations: current.registrations, byExposedName: current.byExposedName };
  }

  const registrations: ExternalMcpToolRegistration[] = [];
  const byExposedName = new Map<string, ExternalMcpToolRegistration>();
  const runtimes = new Map<string, ServerRuntime>();

  let servers: Awaited<ReturnType<typeof fetchEnabledServers>>;
  try {
    servers = await fetchEnabledServers();
  } catch (error) {
    // 数据库暂不可用：沿用旧注册表（若有），不阻塞对话
    console.error("[agent-mcp-external] 配置读取失败，沿用上次注册表:", error);
    return { registrations: current.registrations, byExposedName: current.byExposedName };
  }

  for (const server of servers) {
    try {
      const runtime = await connectServer(server.serverId, server.serverName, server.url, server.apiKey);
      runtimes.set(server.serverId, runtime);
      const listed = await runtime.client.listTools();
      for (const tool of listed.tools ?? []) {
        if (typeof tool.name !== "string" || !tool.name) continue;
        let exposed = sanitizeExternalToolName(tool.name);
        while (byExposedName.has(exposed)) exposed = `${exposed.slice(0, 62)}_2`;
        const registration: ExternalMcpToolRegistration = {
          exposedName: exposed,
          serverId: server.serverId,
          serverName: server.serverName,
          originalName: tool.name,
          description: typeof tool.description === "string" ? tool.description.slice(0, 800) : "",
          inputSchema: (tool.inputSchema && typeof tool.inputSchema === "object"
            ? tool.inputSchema
            : { type: "object", properties: {} }) as Record<string, unknown>,
        };
        registrations.push(registration);
        byExposedName.set(exposed, registration);
      }
    } catch (error) {
      console.error(`[agent-mcp-external] 服务「${server.serverName}」连接失败，本轮跳过:`, error);
    }
  }

  // 旧运行时里已不在新集合的服务，关闭连接
  for (const [oldServerId, oldRuntime] of current.runtimes) {
    if (!runtimes.has(oldServerId)) void oldRuntime.client.close().catch(() => undefined);
  }

  const next: RegistryCache = { registrations, byExposedName, runtimes, fetchedAt: Date.now() };
  globalCache.__xiaochuanExternalMcpCache = next;
  return { registrations, byExposedName };
}

async function runtimeFor(registration: ExternalMcpToolRegistration): Promise<ServerRuntime> {
  const current = cache();
  const existing = current.runtimes.get(registration.serverId);
  if (existing) return existing;
  const rows = await prisma.agentMcpServer.findUnique({ where: { id: registration.serverId } });
  if (!rows || !rows.isEnabled) throw new Error(`MCP 服务「${registration.serverName}」已停用`);
  const apiKey = rows.apiKeyCipher ? decryptApiKey(rows.apiKeyCipher) : null;
  const runtime = await connectServer(rows.id, rows.name, resolveServerUrl(rows.url, apiKey), apiKey);
  current.runtimes.set(rows.id, runtime);
  return runtime;
}

/** 执行外部工具；连接失效自动重建一次再试 */
export async function callExternalMcpTool(
  registration: ExternalMcpToolRegistration,
  args: Record<string, unknown>,
  timeoutMs = 20_000,
): Promise<unknown> {
  const attempt = async () => {
    const runtime = await runtimeFor(registration);
    const result = await runtime.client.callTool({ name: registration.originalName, arguments: args }, undefined, {
      timeout: timeoutMs,
    });
    return result;
  };
  try {
    return await attempt();
  } catch (firstError) {
    // 连接可能已断：清掉该服务缓存连接后重试一次
    const current = cache();
    current.runtimes.delete(registration.serverId);
    try {
      return await attempt();
    } catch {
      throw firstError;
    }
  }
}

/** 管理端「测试连接」：连上并列出工具；返回工具数量与名称 */
export async function testExternalMcpServer(url: string, apiKey: string | null): Promise<{ ok: boolean; message: string; tools?: string[] }> {
  try {
    const client = new Client({ name: "dachuan-xiaochuan-test", version: "1.0.0" });
    const headers: Record<string, string> = {};
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const names = (listed.tools ?? []).map((tool) => String(tool.name));
      return { ok: true, message: `连接成功，发现 ${names.length} 个工具`, tools: names };
    } finally {
      void client.close().catch(() => undefined);
    }
  } catch (error) {
    return { ok: false, message: `连接失败：${error instanceof Error ? error.message : "未知错误"}` };
  }
}
