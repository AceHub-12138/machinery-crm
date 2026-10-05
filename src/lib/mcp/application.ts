import { createHash, timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpToolErrorResult, MCP_IDENTITY_TOOL_NAME, McpToolError, registerMcpTools } from "@/lib/mcp/tools";
import { AgentAssertionError } from "@/lib/agent-auth/token";
import { registerMcpCommandTools } from "@/lib/mcp/command-tools";
import { LeadWriterRateLimitError } from "@/lib/agent-auth/service-runtime";

// AGENT_ACCOUNT：Agent 独立账号（非 CRM 员工）。不参与任何业务工具角色矩阵，
// canCallMcpBusinessTool 对它恒为 false —— 业务工具不下发、调用再校验必拒，双保险。
export type McpRole = "SUPER_ADMIN" | "SALES" | "FOREIGN_TRADE" | "PURCHASE" | "WAREHOUSE" | "AGENT_ACCOUNT";
export type McpStaffRole = Exclude<McpRole, "AGENT_ACCOUNT">;

export type McpUser = {
  id: string;
  isActive?: boolean;
  name?: string | null;
  email?: string | null;
  role: McpRole;
  region: string;
  territories: Array<{ province: string; cities: string[] }>;
  viewScope: string;
};

export type McpStaffUser = Omit<McpUser, "role"> & { role: McpStaffRole };

export function isMcpStaffUser(user: McpUser): user is McpStaffUser {
  return user.role !== "AGENT_ACCOUNT";
}

export type McpServicePrincipal = {
  principalType: "SERVICE";
  principalId: string;
  scopes: string[];
  jti: string;
};

export type McpCommandContext = {
  requestId: string;
  principal: McpServicePrincipal;
};

export type McpApiKeyConfig = {
  name: string;
  userId?: string;
  keyHash: string;
};

export type McpApplicationConfig = {
  apiKeys: McpApiKeyConfig[];
  rejectedAuditUserId: string;
  queryDatabaseUrl?: string;
  auditDatabaseUrl?: string;
  commandDatabaseUrl?: string;
  allowedHosts: string[];
  allowedOrigins: string[];
  legacyUserBindingEnabled?: boolean;
  toolMode?: "identity-poc" | "full-read-only" | "lead-write-internal";
  allowedBusinessToolNames?: string[];
  allowedBusinessToolRoles?: McpRole[];
  allowedCommandToolNames?: string[];
  allowedServicePrincipalIds?: string[];
  queryTimeoutMs?: number;
  diagnosticLogging?: boolean;
};

export type McpAuditInput = {
  requestId: string;
  userId: string;
  apiKeyName: string;
  method: string;
  toolName?: string;
  success: boolean;
  statusCode: number;
  durationMs: number;
  createdAt: Date;
  rejectionReason?: string;
};

export type McpDataSource = {
  findUser?(userId: string): Promise<McpUser | null>;
  findActiveUser?(userId: string): Promise<McpUser | null>;
  execute(toolName: string, args: Record<string, unknown>, user: McpUser): Promise<unknown>;
  executeCommand?(toolName: string, args: Record<string, unknown>, context: McpCommandContext): Promise<unknown>;
  writeAudit(input: McpAuditInput): Promise<void>;
};

export type McpIdentityVerifier = {
  verify(assertion: string): Promise<{ userId: string; jti: string }>;
};

export type McpServiceIdentityVerifier = {
  verify(assertion: string): Promise<McpServicePrincipal>;
};

export type McpApplicationDependencies = {
  config: McpApplicationConfig;
  dataSource: McpDataSource;
  identityVerifier?: McpIdentityVerifier;
  serviceIdentityVerifier?: McpServiceIdentityVerifier;
  now?: () => Date;
};

function validRequestId(value: string | null) {
  if (!value) return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(normalized) ? normalized : null;
}

function diagnosticErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return "UNAVAILABLE";
  const code = error.code;
  return typeof code === "string" || typeof code === "number" ? String(code) : "UNAVAILABLE";
}

function writeAuditDiagnostic(
  enabled: boolean,
  entry: Record<string, unknown>,
) {
  if (enabled !== true) return;
  console.warn(JSON.stringify({ event: "MCP_AUDIT_DIAGNOSTIC", ...entry }));
}

async function findCurrentUser(dataSource: McpDataSource, userId: string) {
  if (dataSource.findUser) return dataSource.findUser(userId);
  if (dataSource.findActiveUser) return dataSource.findActiveUser(userId);
  throw new Error("MCP user data source is not configured");
}

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: unknown;
  };
};

function jsonResponse(status: number, body: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function jsonRpcError(status: number, code: number, message: string, id: JsonRpcRequest["id"] = null) {
  return jsonResponse(status, {
    jsonrpc: "2.0",
    error: { code, message },
    id,
  });
}

function normalizeHash(value: string) {
  return value.trim().toLowerCase().replace(/^sha256:/, "");
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest();
}

function findApiKey(authorization: string | null, entries: McpApiKeyConfig[]) {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const presented = sha256(match[1]);
  return entries.find((entry) => {
    const normalized = normalizeHash(entry.keyHash);
    if (!/^[a-f0-9]{64}$/.test(normalized)) return false;
    return timingSafeEqual(presented, Buffer.from(normalized, "hex"));
  }) ?? null;
}

function normalizeHeaderValue(value: string) {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function requestHost(request: Request) {
  return normalizeHeaderValue(request.headers.get("x-forwarded-host") || request.headers.get("host") || "");
}

function isAllowedRequestSource(request: Request, config: McpApplicationConfig) {
  const allowedHosts = config.allowedHosts.map(normalizeHeaderValue);
  if (allowedHosts.length === 0 || !allowedHosts.includes(requestHost(request))) return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;
  return config.allowedOrigins.map(normalizeHeaderValue).includes(normalizeHeaderValue(origin));
}

async function readJsonRpcRequest(request: Request): Promise<JsonRpcRequest> {
  try {
    return await request.clone().json() as JsonRpcRequest;
  } catch {
    return {};
  }
}

function responseSucceeded(status: number, payload: unknown) {
  if (status < 200 || status >= 300) return false;
  if (!payload || typeof payload !== "object") return true;
  const response = payload as { error?: unknown; result?: { isError?: boolean } };
  return !response.error && response.result?.isError !== true;
}

function responseRejectionReason(payload: unknown) {
  if (!payload || typeof payload !== "object") return "MCP_RESPONSE_ERROR";
  const response = payload as {
    error?: { code?: string | number };
    result?: { structuredContent?: { error?: { code?: string } } };
  };
  return response.result?.structuredContent?.error?.code
    || (response.error?.code !== undefined ? String(response.error.code) : "MCP_RESPONSE_ERROR");
}

const SERVICE_IDENTITY_METHODS = new Set([
  "initialize",
  "ping",
  "tools/list",
  "notifications/initialized",
]);

const TOOL_ERROR_DETAIL_LIMIT = 300;
const SDK_VALIDATION_ERROR_PATTERN = /Input validation error: Invalid arguments for tool [^:]+: ([\s\S]+)$/;
const SDK_UNAVAILABLE_TOOL_PATTERN = /^Tool .+ (?:not found|disabled)$/;

function sanitizeToolErrorText(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim()
    .slice(0, TOOL_ERROR_DETAIL_LIMIT);
}

function formatZodIssues(value: string) {
  try {
    const issues = JSON.parse(value) as unknown;
    if (!Array.isArray(issues)) return null;
    const safeIssues: Array<{ path: Array<string | number>; message: string }> = [];
    const details = issues.map((issue) => {
      if (!issue || typeof issue !== "object") return null;
      const candidate = issue as { path?: unknown; message?: unknown };
      if (!Array.isArray(candidate.path) || typeof candidate.message !== "string") return null;
      const path = candidate.path
        .filter((segment): segment is string | number => typeof segment === "string" || typeof segment === "number");
      safeIssues.push({ path, message: candidate.message });
      return `${path.join(".")}: ${candidate.message}`;
    });
    if (details.length === 0 || details.some((detail) => detail === null)) return null;
    return { details: details.join("；"), safeIssues };
  } catch {
    return null;
  }
}

function safeToolErrorMessage(rawMessage: string) {
  const withoutSdkPrefix = rawMessage.replace(/^MCP error -32602:\s*/, "");
  const validationMatch = withoutSdkPrefix.match(SDK_VALIDATION_ERROR_PATTERN);
  if (validationMatch) {
    const parsedIssues = formatZodIssues(validationMatch[1]);
    if (!parsedIssues && /"(?:input|received)"\s*:/i.test(validationMatch[1])) {
      return { message: "", diagnosticRawMessage: "unavailable" };
    }
    const message = sanitizeToolErrorText(parsedIssues?.details ?? validationMatch[1]);
    const diagnosticRawMessage = parsedIssues
      ? sanitizeToolErrorText(rawMessage.slice(0, rawMessage.length - validationMatch[1].length) + JSON.stringify(parsedIssues.safeIssues))
      : sanitizeToolErrorText(rawMessage);
    return { message, diagnosticRawMessage };
  }

  const sanitizedRawMessage = sanitizeToolErrorText(withoutSdkPrefix);
  if (SDK_UNAVAILABLE_TOOL_PATTERN.test(sanitizedRawMessage)) {
    return {
      message: sanitizeToolErrorText(`工具不可用：${sanitizedRawMessage}`),
      diagnosticRawMessage: sanitizeToolErrorText(rawMessage),
    };
  }
  return { message: sanitizedRawMessage, diagnosticRawMessage: sanitizeToolErrorText(rawMessage) };
}

function sdkToolErrorMessage(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content) || !content[0] || typeof content[0] !== "object") return null;
  const text = (content[0] as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}

function normalizeToolProtocolError(
  response: Response,
  payload: unknown,
  rpcRequest: JsonRpcRequest,
  requestId: string,
  generatedAt: Date,
  diagnosticLogging: boolean,
) {
  if (rpcRequest.method !== "tools/call" || !payload || typeof payload !== "object") return { response, payload };
  const rpcPayload = payload as {
    error?: { code?: number; message?: unknown };
    result?: { content?: unknown; isError?: boolean; structuredContent?: unknown };
  };
  const sdkToolError = rpcPayload.result?.isError === true && !rpcPayload.result.structuredContent;
  if (!rpcPayload.error && !sdkToolError) return { response, payload };
  const rawMessage = sdkToolError
    ? sdkToolErrorMessage(rpcPayload.result)
    : rpcPayload.error?.code === -32602 && typeof rpcPayload.error.message === "string"
      ? rpcPayload.error.message
      : null;
  const safeError = rawMessage ? safeToolErrorMessage(rawMessage) : null;
  if (diagnosticLogging === true) {
    console.warn(JSON.stringify({
      event: "MCP_RAW_TOOL_ERROR",
      requestId,
      toolName: rpcRequest.params?.name || "unknown_tool",
      rawMessage: safeError?.diagnosticRawMessage || "unavailable",
    }));
  }
  const result = createMcpToolErrorResult(
    requestId,
    rpcRequest.params?.name || "unknown_tool",
    generatedAt,
    new McpToolError(
      rpcPayload.error?.code === -32602 || sdkToolError ? "INVALID_ARGUMENT" : "MCP_PROTOCOL_ERROR",
      safeError?.message || "工具参数无效或工具不存在",
    ),
  );
  const normalizedPayload = { jsonrpc: "2.0", id: rpcRequest.id ?? null, result };
  return { response: jsonResponse(200, normalizedPayload), payload: normalizedPayload };
}

export function createMcpRequestHandler(dependencies: McpApplicationDependencies) {
  const now = dependencies.now ?? (() => new Date());

  return async function handleMcpRequest(request: Request): Promise<Response> {
    const startedAt = now();
    const rpcRequest = await readJsonRpcRequest(request);
    const presentedRequestId = validRequestId(request.headers.get("x-dachuan-request-id"));
    const requestId = presentedRequestId ?? "request-id-missing";

    const rejectWithAudit = async (
      status: number,
      code: number,
      message: string,
      apiKeyName: string,
      rejectionReason: string,
      auditUserId = dependencies.config.rejectedAuditUserId,
    ) => {
      const completedAt = now();
      try {
        await dependencies.dataSource.writeAudit({
          requestId,
          userId: auditUserId,
          apiKeyName,
          method: rpcRequest.method || "unknown",
          toolName: rpcRequest.method === "tools/call" ? rpcRequest.params?.name : undefined,
          success: false,
          statusCode: status,
          durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
          createdAt: completedAt,
          rejectionReason,
        });
      } catch {
        return jsonRpcError(503, -32603, "MCP audit log is unavailable", rpcRequest.id);
      }
      return jsonRpcError(status, code, message, rpcRequest.id);
    };

    if (!isAllowedRequestSource(request, dependencies.config)) {
      return rejectWithAudit(403, -32003, "MCP request source is not allowed", "[source-rejected]", "SOURCE_NOT_ALLOWED");
    }

    const apiKey = findApiKey(request.headers.get("authorization"), dependencies.config.apiKeys);
    if (!apiKey) {
      console.warn(JSON.stringify({ event: "MCP_AUTH_REJECTED", requestId, method: rpcRequest.method || "unknown" }));
      return rejectWithAudit(401, -32001, "Invalid MCP API key", "[key-rejected]", "SERVICE_KEY_INVALID");
    }

    let userId: string | undefined;
    let user: McpUser | null = null;
    const commandMode = dependencies.config.toolMode === "lead-write-internal";
    const assertion = request.headers.get("x-dachuan-user-assertion")?.trim();
    const serviceAssertion = request.headers.get("x-dachuan-service-assertion")?.trim();
    const useLegacyIdentity = dependencies.config.legacyUserBindingEnabled === true && !assertion;
    const requiresUserIdentity = !SERVICE_IDENTITY_METHODS.has(rpcRequest.method || "");

    if (!presentedRequestId) {
      return rejectWithAudit(400, -32600, "Missing or invalid X-Dachuan-Request-Id", apiKey.name, "REQUEST_ID_INVALID");
    }

    const requestedToolName = rpcRequest.method === "tools/call" ? rpcRequest.params?.name : undefined;
    if (
      requestedToolName
      && requestedToolName !== MCP_IDENTITY_TOOL_NAME
      && ((commandMode
        && dependencies.config.allowedCommandToolNames
        && !dependencies.config.allowedCommandToolNames.includes(requestedToolName))
        || (!commandMode
          && dependencies.config.allowedBusinessToolNames
          && !dependencies.config.allowedBusinessToolNames.includes(requestedToolName)))
    ) {
      return rejectWithAudit(403, -32003, "MCP tool is not enabled", apiKey.name, "TOOL_NOT_ALLOWED");
    }

    let servicePrincipal: McpServicePrincipal | null = null;
    if (commandMode && requiresUserIdentity) {
      if (!serviceAssertion) {
        return rejectWithAudit(400, -32600, "Missing X-Dachuan-Service-Assertion", apiKey.name, "SERVICE_ASSERTION_MISSING");
      }
      if (!dependencies.serviceIdentityVerifier) {
        return rejectWithAudit(503, -32603, "MCP service identity verifier is unavailable", apiKey.name, "SERVICE_IDENTITY_VERIFIER_UNAVAILABLE");
      }
      try {
        servicePrincipal = await dependencies.serviceIdentityVerifier.verify(serviceAssertion);
      } catch (error) {
        if (error instanceof LeadWriterRateLimitError) {
          return rejectWithAudit(429, -32029, "Lead writer rate limit exceeded", apiKey.name, "SERVICE_RATE_LIMITED");
        }
        const reason = error instanceof AgentAssertionError ? error.code : "ASSERTION_INVALID";
        return rejectWithAudit(401, -32001, "Invalid service assertion", apiKey.name, reason);
      }
    } else if (useLegacyIdentity) {
      userId = apiKey.userId;
      if (!userId) {
        return rejectWithAudit(403, -32003, "Legacy MCP identity is not configured", apiKey.name, "LEGACY_IDENTITY_MISSING");
      }
    } else {
      if (requiresUserIdentity && !commandMode) {
        if (!assertion) {
          return rejectWithAudit(400, -32600, "Missing X-Dachuan-User-Assertion", apiKey.name, "ASSERTION_MISSING");
        }
        if (!dependencies.identityVerifier) {
          return rejectWithAudit(503, -32603, "MCP identity verifier is unavailable", apiKey.name, "IDENTITY_VERIFIER_UNAVAILABLE");
        }
        try {
          userId = (await dependencies.identityVerifier.verify(assertion)).userId;
        } catch (error) {
          const reason = error instanceof AgentAssertionError ? error.code : "ASSERTION_INVALID";
          return rejectWithAudit(401, -32001, "Invalid user assertion", apiKey.name, reason);
        }
      }
    }

    if (userId) {
      user = await findCurrentUser(dependencies.dataSource, userId);
      if (!user) {
        console.warn(JSON.stringify({ event: "MCP_USER_REJECTED", requestId, apiKeyName: apiKey.name }));
        return rejectWithAudit(403, -32003, "MCP user is disabled or missing", apiKey.name, "USER_NOT_FOUND");
      }
      if (user.isActive === false) {
        return rejectWithAudit(403, -32003, "MCP user is disabled or missing", apiKey.name, "USER_DISABLED", user.id);
      }
    }

    const server = new McpServer(
      { name: "dachuanpro-crm-erp", version: "1.0.0" },
      {
        instructions: "DachuanPro CRM/ERP 只读查询服务。工具调用使用当前 CRM/ERP 登录用户身份。",
      },
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    if (commandMode) {
      registerMcpCommandTools(server, {
        requestId,
        principal: servicePrincipal,
        dataSource: dependencies.dataSource,
        now,
        allowedCommandToolNames: dependencies.config.allowedCommandToolNames,
        allowedServicePrincipalIds: dependencies.config.allowedServicePrincipalIds,
      });
    } else {
      registerMcpTools(server, {
        requestId,
        user,
        dataSource: dependencies.dataSource,
        now,
        includeBusinessTools: dependencies.config.toolMode !== "identity-poc",
        allowedBusinessToolNames: dependencies.config.allowedBusinessToolNames,
        allowedBusinessToolRoles: dependencies.config.allowedBusinessToolRoles,
        queryTimeoutMs: dependencies.config.queryTimeoutMs ?? 5_000,
        diagnosticLogging: dependencies.config.diagnosticLogging === true,
      });
    }

    let response: Response;
    try {
      await server.connect(transport);
      response = await transport.handleRequest(request);
    } catch (error) {
      if (dependencies.config.diagnosticLogging === true) {
        console.warn(JSON.stringify({
          event: "MCP_TRANSPORT_DIAGNOSTIC",
          requestId,
          method: rpcRequest.method || "unknown",
          toolName: rpcRequest.method === "tools/call" ? String(rpcRequest.params?.name || "unknown") : undefined,
          durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorCode: error instanceof McpToolError ? error.code : "UNEXPECTED",
        }));
      }
      response = jsonRpcError(500, -32603, "Internal MCP server error", rpcRequest.id);
    }

    let responsePayload: unknown;
    try {
      responsePayload = await response.clone().json();
    } catch {
      responsePayload = null;
    }

    ({ response, payload: responsePayload } = normalizeToolProtocolError(
      response,
      responsePayload,
      rpcRequest,
      requestId,
      now(),
      dependencies.config.diagnosticLogging === true,
    ));

    const completedAt = now();
    const auditStartedAt = now();
    try {
      const success = responseSucceeded(response.status, responsePayload);
      await dependencies.dataSource.writeAudit({
        requestId,
        userId: user?.id ?? dependencies.config.rejectedAuditUserId,
        apiKeyName: apiKey.name,
        method: rpcRequest.method || "unknown",
        toolName: rpcRequest.method === "tools/call" ? rpcRequest.params?.name : undefined,
        success,
        statusCode: response.status,
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        createdAt: completedAt,
        rejectionReason: success ? undefined : responseRejectionReason(responsePayload),
      });
      writeAuditDiagnostic(dependencies.config.diagnosticLogging === true, {
        requestId,
        method: rpcRequest.method || "unknown",
        toolName: rpcRequest.method === "tools/call" ? String(rpcRequest.params?.name || "unknown") : undefined,
        outcome: "SUCCESS",
        durationMs: Math.max(0, now().getTime() - auditStartedAt.getTime()),
        responseStatus: response.status,
      });
    } catch (error) {
      writeAuditDiagnostic(dependencies.config.diagnosticLogging === true, {
        requestId,
        method: rpcRequest.method || "unknown",
        toolName: rpcRequest.method === "tools/call" ? String(rpcRequest.params?.name || "unknown") : undefined,
        outcome: "ERROR",
        durationMs: Math.max(0, now().getTime() - auditStartedAt.getTime()),
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorCode: diagnosticErrorCode(error),
      });
      await server.close().catch(() => undefined);
      return jsonRpcError(503, -32603, "MCP audit log is unavailable", rpcRequest.id);
    }

    await server.close().catch(() => undefined);
    return response;
  };
}
