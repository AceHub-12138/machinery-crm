import { randomUUID } from "node:crypto";
import type { AgentTokenService } from "@/lib/agent-auth/token";

export type AgentGatewayConfig = {
  fastGptChatUrl: string;
  fastGptApiKey: string;
  maxRequestBytes: number;
  rateLimitPerMinute?: number;
  allowedOrigins: string[];
};

export type AgentGatewayDependencies = {
  config: AgentGatewayConfig;
  tokenService: AgentTokenService;
  loadLoggedInUser(request: Request): Promise<{ id: string } | null>;
  fetchFastGpt?: typeof fetch;
  createRequestId?: () => string;
  rateLimiter?: {
    consume(subject: string, limit: number, windowSeconds: number): Promise<boolean>;
  };
};

function jsonResponse(status: number, body: unknown, requestId?: string) {
  return Response.json(body, {
    status,
    headers: requestId ? { "x-dachuan-request-id": requestId } : undefined,
  });
}

function responseHeaders(upstream: Response, requestId: string) {
  const headers = new Headers({
    "cache-control": "no-store",
    "x-dachuan-request-id": requestId,
  });
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  return headers;
}

export function createAgentGatewayHandler(dependencies: AgentGatewayDependencies) {
  const fetchFastGpt = dependencies.fetchFastGpt ?? fetch;
  const createRequestId = dependencies.createRequestId ?? randomUUID;

  return async function handleAgentGatewayRequest(request: Request): Promise<Response> {
    const requestId = createRequestId();
    const origin = request.headers.get("origin")?.trim().toLowerCase();
    const allowedOrigins = dependencies.config.allowedOrigins.map((item) => item.trim().toLowerCase());
    if (!origin || !allowedOrigins.includes(origin)) {
      return jsonResponse(403, {
        ok: false,
        error: { code: "ORIGIN_NOT_ALLOWED", message: "Agent 请求来源无效" },
      }, requestId);
    }
    const user = await dependencies.loadLoggedInUser(request);
    if (!user) {
      return jsonResponse(401, { ok: false, error: { code: "AUTH_REQUIRED", message: "请先登录 CRM/ERP" } }, requestId);
    }

    if (dependencies.rateLimiter && dependencies.config.rateLimitPerMinute) {
      let allowed = false;
      try {
        allowed = await dependencies.rateLimiter.consume(
          `gateway:${user.id}`,
          dependencies.config.rateLimitPerMinute,
          60,
        );
      } catch {
        return jsonResponse(503, {
          ok: false,
          error: { code: "IDENTITY_STATE_UNAVAILABLE", message: "Agent 身份状态服务暂不可用" },
        }, requestId);
      }
      if (!allowed) {
        return jsonResponse(429, {
          ok: false,
          error: { code: "RATE_LIMITED", message: "Agent 请求过于频繁，请稍后重试" },
        }, requestId);
      }
    }

    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      return jsonResponse(415, { ok: false, error: { code: "JSON_REQUIRED", message: "请求必须使用 JSON" } }, requestId);
    }
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > dependencies.config.maxRequestBytes) {
      return jsonResponse(413, { ok: false, error: { code: "REQUEST_TOO_LARGE", message: "Agent 请求过大" } }, requestId);
    }
    try {
      JSON.parse(body);
    } catch {
      return jsonResponse(400, { ok: false, error: { code: "INVALID_JSON", message: "请求 JSON 无效" } }, requestId);
    }

    try {
      const assertion = await dependencies.tokenService.issue(user.id);
      const upstream = await fetchFastGpt(dependencies.config.fastGptChatUrl, {
        method: "POST",
        headers: {
          accept: request.headers.get("accept") || "application/json",
          authorization: `Bearer ${dependencies.config.fastGptApiKey}`,
          "content-type": "application/json",
          "x-dachuan-request-id": requestId,
          "x-dachuan-user-assertion": assertion.token,
        },
        body,
        redirect: "error",
      });
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders(upstream, requestId),
      });
    } catch {
      return jsonResponse(503, {
        ok: false,
        error: { code: "AGENT_GATEWAY_UNAVAILABLE", message: "Agent 身份网关暂不可用" },
      }, requestId);
    }
  };
}
