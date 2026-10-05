import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAgentGatewayHandler } from "@/lib/agent-auth/gateway";
import { createAgentTokenService, type AgentJtiStore } from "@/lib/agent-auth/token";

function tokenService() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const active = new Set<string>();
  const store: AgentJtiStore = {
    async register(jti) { active.add(jti); },
    async isActive(jti) { return active.has(jti); },
    async revoke(jti) { active.delete(jti); },
  };
  return createAgentTokenService({
    issuer: "dachuanpro-crm",
    audience: "dachuanpro-agent-mcp",
    ttlSeconds: 600,
    activeKid: "gateway-test",
    signingKeys: [{ kid: "gateway-test", key: privateKey }],
    verificationKeys: [{ kid: "gateway-test", key: publicKey }],
    stateStore: store,
  });
}

describe("agent auth gateway", () => {
  it("keeps concurrent ERP user identities isolated in trusted FastGPT headers", async () => {
    const tokens = tokenService();
    const forwarded: Array<{ requestId: string; assertion: string; body: string }> = [];
    const handler = createAgentGatewayHandler({
      config: {
        fastGptChatUrl: "https://fastgpt.internal/api/v1/chat/completions",
        fastGptApiKey: "fastgpt-chat-key",
        maxRequestBytes: 100_000,
        allowedOrigins: ["https://crm.test"],
      },
      tokenService: tokens,
      async loadLoggedInUser(request) {
        const userId = request.headers.get("x-test-session-user");
        if (!userId) return null;
        await new Promise((resolve) => setTimeout(resolve, userId.endsWith("1") ? 15 : 1));
        return { id: userId };
      },
      createRequestId: (() => {
        let sequence = 0;
        return () => `request-${++sequence}`;
      })(),
      async fetchFastGpt(_url, init) {
        const headers = new Headers(init?.headers);
        const body = String(init?.body || "");
        forwarded.push({
          requestId: headers.get("x-dachuan-request-id") || "",
          assertion: headers.get("x-dachuan-user-assertion") || "",
          body,
        });
        expect(headers.get("authorization")).toBe("Bearer fastgpt-chat-key");
        expect(body).not.toContain("x-dachuan-user-assertion");
        return Response.json({ ok: true });
      },
    });

    const [first, second] = await Promise.all([
      handler(new Request("https://crm.test/api/agent-gateway/chat", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://crm.test", "x-test-session-user": "erp-user-1" },
        body: JSON.stringify({ messages: [{ role: "user", content: "first" }] }),
      })),
      handler(new Request("https://crm.test/api/agent-gateway/chat", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://crm.test", "x-test-session-user": "erp-user-2" },
        body: JSON.stringify({ messages: [{ role: "user", content: "second" }] }),
      })),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(forwarded).toHaveLength(2);
    const identities = await Promise.all(forwarded.map((item) => tokens.verify(item.assertion)));
    expect(new Set(identities.map((item) => item.userId))).toEqual(new Set(["erp-user-1", "erp-user-2"]));
    expect(new Set(forwarded.map((item) => item.requestId)).size).toBe(2);
  });

  it("keeps many sessions and browser tabs isolated under interleaved load", async () => {
    const tokens = tokenService();
    const forwarded: Array<{ assertion: string; requestId: string; marker: string }> = [];
    const handler = createAgentGatewayHandler({
      config: {
        fastGptChatUrl: "https://fastgpt.internal/api/v1/chat/completions",
        fastGptApiKey: "fastgpt-chat-key",
        maxRequestBytes: 100_000,
        allowedOrigins: ["https://crm.test"],
      },
      tokenService: tokens,
      async loadLoggedInUser(request) {
        const userId = request.headers.get("x-test-session-user");
        const delay = Number(request.headers.get("x-test-delay") || "0");
        await new Promise((resolve) => setTimeout(resolve, delay));
        return userId ? { id: userId } : null;
      },
      async fetchFastGpt(_url, init) {
        const headers = new Headers(init?.headers);
        const body = JSON.parse(String(init?.body || "{}")) as { marker: string };
        await new Promise((resolve) => setTimeout(resolve, Number(body.marker.split("-").at(-1)) % 5));
        forwarded.push({
          assertion: headers.get("x-dachuan-user-assertion") || "",
          requestId: headers.get("x-dachuan-request-id") || "",
          marker: body.marker,
        });
        return Response.json({ marker: body.marker });
      },
    });

    const calls = Array.from({ length: 48 }, (_, index) => {
      const userId = `erp-user-${index % 4}`;
      const marker = `${userId}-tab-${index % 3}-call-${index}`;
      return handler(new Request("https://crm.test/api/agent-gateway/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://crm.test",
          "x-test-session-user": userId,
          "x-test-delay": String((47 - index) % 7),
        },
        body: JSON.stringify({ marker }),
      }));
    });

    const responses = await Promise.all(calls);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(forwarded).toHaveLength(48);
    expect(new Set(forwarded.map((item) => item.requestId)).size).toBe(48);
    for (const item of forwarded) {
      const verified = await tokens.verify(item.assertion);
      expect(item.marker.startsWith(`${verified.userId}-tab-`)).toBe(true);
    }
  });

  it("requires a current logged-in ERP user and never forwards browser credentials", async () => {
    let called = false;
    const handler = createAgentGatewayHandler({
      config: {
        fastGptChatUrl: "https://fastgpt.internal/api/v1/chat/completions",
        fastGptApiKey: "fastgpt-chat-key",
        maxRequestBytes: 100_000,
        allowedOrigins: ["https://crm.test"],
      },
      tokenService: tokenService(),
      loadLoggedInUser: async () => null,
      fetchFastGpt: async () => {
        called = true;
        return Response.json({ ok: true });
      },
    });

    const response = await handler(new Request("https://crm.test/api/agent-gateway/chat", {
      method: "POST",
      headers: { authorization: "Bearer browser-token", cookie: "session=secret", "content-type": "application/json", origin: "https://crm.test" },
      body: "{}",
    }));

    expect(response.status).toBe(401);
    expect(called).toBe(false);
    const body = await response.text();
    expect(body).not.toContain("browser-token");
    expect(body).not.toContain("session=secret");
  });

  it("rejects cross-origin requests before loading the ERP session", async () => {
    let loadedSession = false;
    const handler = createAgentGatewayHandler({
      config: {
        fastGptChatUrl: "https://fastgpt.internal/api/v1/chat/completions",
        fastGptApiKey: "fastgpt-chat-key",
        maxRequestBytes: 100_000,
        allowedOrigins: ["https://crm.test"],
      },
      tokenService: tokenService(),
      loadLoggedInUser: async () => {
        loadedSession = true;
        return { id: "erp-user-1" };
      },
    });

    const response = await handler(new Request("https://crm.test/api/agent-gateway/chat", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.test" },
      body: "{}",
    }));

    expect(response.status).toBe(403);
    expect(loadedSession).toBe(false);
  });
});
