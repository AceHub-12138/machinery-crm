import { NextResponse } from "next/server";
import { createAgentGatewayHandler } from "@/lib/agent-auth/gateway";
import { getAgentAuthRuntime } from "@/lib/agent-auth/runtime";
import { verifyCrmAgentAssertion } from "@/lib/agent-auth/crm-assertion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const agentAuth = await getAgentAuthRuntime();
    const handler = createAgentGatewayHandler({
      config: {
        fastGptChatUrl: agentAuth.config.fastGptChatUrl,
        fastGptApiKey: agentAuth.config.fastGptApiKey,
        maxRequestBytes: agentAuth.config.maxRequestBytes,
        rateLimitPerMinute: agentAuth.config.rateLimitPerMinute,
        allowedOrigins: agentAuth.config.gatewayAllowedOrigins,
      },
      tokenService: agentAuth.tokenService,
      rateLimiter: agentAuth.stateStore,
      loadLoggedInUser: async (gatewayRequest) => {
        const identity = await verifyCrmAgentAssertion(
          gatewayRequest.headers.get("authorization"),
          agentAuth.config.crmAssertionSecret,
        );
        return identity ? { id: identity.userId } : null;
      },
    });
    return await handler(request);
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "AGENT_GATEWAY_NOT_CONFIGURED", message: "Agent 身份网关未配置" } },
      { status: 503 },
    );
  }
}
