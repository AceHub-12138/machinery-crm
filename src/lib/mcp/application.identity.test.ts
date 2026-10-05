import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createMcpRequestHandler,
  type McpApplicationDependencies,
  type McpUser,
} from "@/lib/mcp/application";
import {
  AgentAssertionError,
  createAgentTokenService,
  type AgentJtiStore,
} from "@/lib/agent-auth/token";

const users: Record<string, McpUser> = {
  "erp-user-1": {
    id: "erp-user-1",
    isActive: true,
    name: "销售甲",
    role: "SALES",
    region: "华东",
    territories: [{ province: "山东省", cities: ["济南市"] }],
    viewScope: "TERRITORY",
  },
  "erp-user-2": {
    id: "erp-user-2",
    isActive: true,
    name: "采购乙",
    role: "PURCHASE",
    region: "总部",
    territories: [],
    viewScope: "ALL",
  },
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function dependencies(): McpApplicationDependencies {
  return {
    config: {
      apiKeys: [{ name: "fastgpt-service", keyHash: sha256("service-secret") }],
      rejectedAuditUserId: "audit-user",
      allowedHosts: ["mcp.example.com"],
      allowedOrigins: [],
      legacyUserBindingEnabled: false,
      toolMode: "identity-poc",
    },
    identityVerifier: {
      async verify(assertion) {
        if (assertion === "assertion-user-1") return { userId: "erp-user-1", jti: "jti-1" };
        if (assertion === "assertion-user-2") return { userId: "erp-user-2", jti: "jti-2" };
        throw new AgentAssertionError("ASSERTION_INVALID", "invalid");
      },
    },
    dataSource: {
      findUser: vi.fn(async (userId: string) => users[userId] ?? null),
      execute: vi.fn(),
      writeAudit: vi.fn().mockResolvedValue(undefined),
    },
    now: () => new Date("2026-07-17T08:00:00.000Z"),
  };
}

function request(
  body: unknown,
  options: { assertion?: string; requestId?: string; serviceKey?: string } = {},
) {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${options.serviceKey ?? "service-secret"}`,
    "content-type": "application/json",
    host: "mcp.example.com",
  });
  if (options.assertion) headers.set("x-dachuan-user-assertion", options.assertion);
  if (options.requestId) headers.set("x-dachuan-request-id", options.requestId);
  return new Request("https://mcp.example.com/api/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function callWhoAmI(assertion: string, requestId: string, args: Record<string, unknown> = {}) {
  return request({
    jsonrpc: "2.0",
    id: requestId,
    method: "tools/call",
    params: { name: "dachuan_identity_who_am_i", arguments: args },
  }, { assertion, requestId });
}

describe("MCP strict dual identity PoC", () => {
  it("allows tools/list with service key and request id but no user assertion", async () => {
    const deps = dependencies();
    const response = await createMcpRequestHandler(deps)(request(
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      { requestId: "catalog-request-1" },
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "dachuan_identity_who_am_i",
    ]);
    expect(deps.dataSource.findUser).not.toHaveBeenCalled();
    expect(deps.dataSource.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "catalog-request-1",
      userId: "audit-user",
      method: "tools/list",
      success: true,
    }));
  });

  it("publishes a business-facing catalog without implementation or permission details", async () => {
    const deps = dependencies();
    deps.config.toolMode = "full-read-only";
    const response = await createMcpRequestHandler(deps)(request(
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      { requestId: "catalog-safety-1" },
    ));
    const payload = await response.json();
    const catalogText = payload.result.tools
      .map((tool: { name: string; title?: string; description?: string }) =>
        `${tool.name} ${tool.title ?? ""} ${tool.description ?? ""}`)
      .join("\n");

    expect(payload.result.tools).toHaveLength(25);
    expect(catalogText).not.toMatch(/Prisma|MySQL|SQL|数据库|数据表|字段表达式/i);
    expect(catalogText).not.toMatch(/角色|权限|负责省市|业务线|受限视图|SUPER_ADMIN/i);
    expect(deps.dataSource.findUser).not.toHaveBeenCalled();
  });

  it("allows initialize and ping with service identity only", async () => {
    const cases = [
      {
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "fastgpt-admin", version: "4.15.1" },
        },
      },
      { method: "ping", params: {} },
    ];

    for (const [index, input] of cases.entries()) {
      const deps = dependencies();
      const response = await createMcpRequestHandler(deps)(request(
        { jsonrpc: "2.0", id: index + 1, ...input },
        { requestId: `service-method-${index + 1}` },
      ));

      expect(response.status).toBe(200);
      expect(deps.dataSource.findUser).not.toHaveBeenCalled();
      expect(deps.dataSource.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
        requestId: `service-method-${index + 1}`,
        userId: "audit-user",
        method: input.method,
        success: true,
      }));
    }
  });

  it("accepts the initialized notification with service identity only", async () => {
    const deps = dependencies();
    const response = await createMcpRequestHandler(deps)(request(
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      { requestId: "initialized-notification" },
    ));

    expect(response.status).toBe(202);
    expect(deps.dataSource.findUser).not.toHaveBeenCalled();
    expect(deps.dataSource.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "initialized-notification",
      method: "notifications/initialized",
      success: true,
    }));
  });

  it("requires service identity and request id for discovery methods", async () => {
    for (const missing of ["service", "request-id"] as const) {
      const deps = dependencies();
      const response = await createMcpRequestHandler(deps)(request(
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        {
          serviceKey: missing === "service" ? "wrong" : "service-secret",
          requestId: missing === "request-id" ? undefined : "catalog-auth-check",
        },
      ));

      expect(response.status).toBe(missing === "service" ? 401 : 400);
      expect(deps.dataSource.findUser).not.toHaveBeenCalled();
      if (missing === "service") {
        expect(deps.dataSource.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
          requestId: "catalog-auth-check",
          rejectionReason: "SERVICE_KEY_INVALID",
        }));
      } else {
        expect(deps.dataSource.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
          requestId: "request-id-missing",
          rejectionReason: "REQUEST_ID_INVALID",
        }));
      }
    }
  });

  it("rejects a business tool without an assertion before any data access", async () => {
    const deps = dependencies();
    deps.config.toolMode = "full-read-only";
    const response = await createMcpRequestHandler(deps)(request(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "crm_customers_list", arguments: {} },
      },
      { requestId: "business-without-assertion" },
    ));

    expect(response.status).toBe(400);
    expect(deps.dataSource.findUser).not.toHaveBeenCalled();
    expect(deps.dataSource.execute).not.toHaveBeenCalled();
    expect(deps.dataSource.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "business-without-assertion",
      toolName: "crm_customers_list",
      rejectionReason: "ASSERTION_MISSING",
    }));
  });

  it("requires service key, user assertion and request id together for tools/call", async () => {
    for (const missing of ["service", "assertion", "request-id"] as const) {
      const deps = dependencies();
      const response = await createMcpRequestHandler(deps)(request(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "dachuan_identity_who_am_i", arguments: {} },
        },
        {
          serviceKey: missing === "service" ? "wrong" : "service-secret",
          assertion: missing === "assertion" ? undefined : "assertion-user-1",
          requestId: missing === "request-id" ? undefined : "request-three-parts",
        },
      ));
      expect(response.status).toBe(missing === "service" ? 401 : 400);
      expect(deps.dataSource.execute).not.toHaveBeenCalled();
    }
  });

  it("does not restore API-key-bound business identity unless compatibility mode is explicit", async () => {
    const deps = dependencies();
    deps.config.apiKeys[0].userId = "erp-user-1";

    const response = await createMcpRequestHandler(deps)(request(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "dachuan_identity_who_am_i", arguments: {} },
      },
      { requestId: "legacy-bypass-denied" },
    ));

    expect(response.status).toBe(400);
    expect(deps.dataSource.findUser).not.toHaveBeenCalled();
    expect(deps.dataSource.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      rejectionReason: "ASSERTION_MISSING",
    }));
  });

  it("accepts a real Ed25519 assertion and resolves only its signed subject", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const activeJtis = new Set<string>();
    const stateStore: AgentJtiStore = {
      async register(jti) { activeJtis.add(jti); },
      async isActive(jti) { return activeJtis.has(jti); },
      async revoke(jti) { activeJtis.delete(jti); },
    };
    const tokenService = createAgentTokenService({
      issuer: "dachuanpro-crm",
      audience: "dachuanpro-agent-mcp",
      ttlSeconds: 600,
      activeKid: "poc-key",
      signingKeys: [{ kid: "poc-key", key: privateKey }],
      verificationKeys: [{ kid: "poc-key", key: publicKey }],
      stateStore,
      now: () => new Date("2026-07-17T08:00:00.000Z"),
      createJti: () => "signed-jti-1",
    });
    const issued = await tokenService.issue("erp-user-2");
    const deps = dependencies();
    deps.identityVerifier = tokenService;

    const response = await createMcpRequestHandler(deps)(callWhoAmI(
      issued.token,
      "real-eddsa-request",
    ));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.structuredContent.data).toMatchObject({
      userId: "erp-user-2",
      role: "PURCHASE",
      region: "总部",
    });
    expect(JSON.stringify(payload)).not.toContain(issued.token);
  });

  it("returns database identity from who_am_i and audits the concrete ERP user", async () => {
    const deps = dependencies();
    const response = await createMcpRequestHandler(deps)(callWhoAmI(
      "assertion-user-1",
      "request-user-1",
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.result.structuredContent).toMatchObject({
      ok: true,
      data: {
        userId: "erp-user-1",
        role: "SALES",
        region: "华东",
        territories: [{ province: "山东省", cities: ["济南市"] }],
        viewScope: "TERRITORY",
      },
      meta: { requestId: "request-user-1", tool: "dachuan_identity_who_am_i" },
    });
    expect(deps.dataSource.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "request-user-1",
      userId: "erp-user-1",
      apiKeyName: "fastgpt-service",
      toolName: "dachuan_identity_who_am_i",
      success: true,
    }));
  });

  it("does not accept forged userId, role or region as tool arguments", async () => {
    const deps = dependencies();
    const response = await createMcpRequestHandler(deps)(callWhoAmI(
      "assertion-user-1",
      "request-forged",
      {
        userId: "erp-user-2",
        role: "SUPER_ADMIN",
        region: "全国",
        territories: [{ province: "任意", cities: [] }],
        viewScope: "ALL",
      },
    ));
    const payload = await response.json();

    expect(payload.result.isError).toBe(true);
    expect(payload.result.structuredContent.error.code).toBe("INVALID_ARGUMENT");
    expect(deps.dataSource.execute).not.toHaveBeenCalled();
  });

  it("keeps two concurrent identities and request ids isolated", async () => {
    const deps = dependencies();
    vi.mocked(deps.dataSource.findUser!).mockImplementation(async (userId: string) => {
      await new Promise((resolve) => setTimeout(resolve, userId.endsWith("1") ? 12 : 1));
      return users[userId] ?? null;
    });
    const handle = createMcpRequestHandler(deps);

    const [first, second] = await Promise.all([
      handle(callWhoAmI("assertion-user-1", "concurrent-request-1")),
      handle(callWhoAmI("assertion-user-2", "concurrent-request-2")),
    ]);
    const [firstBody, secondBody] = await Promise.all([first.json(), second.json()]);

    expect(firstBody.result.structuredContent.data.userId).toBe("erp-user-1");
    expect(firstBody.result.structuredContent.meta.requestId).toBe("concurrent-request-1");
    expect(secondBody.result.structuredContent.data.userId).toBe("erp-user-2");
    expect(secondBody.result.structuredContent.meta.requestId).toBe("concurrent-request-2");
  });

  it("keeps many sessions and tabs isolated under interleaved MCP load", async () => {
    const deps = dependencies();
    vi.mocked(deps.dataSource.findUser!).mockImplementation(async (userId: string) => {
      await new Promise((resolve) => setTimeout(resolve, userId.endsWith("1") ? 5 : 1));
      return users[userId] ?? null;
    });
    const handle = createMcpRequestHandler(deps);
    const expected = Array.from({ length: 40 }, (_, index) => ({
      userId: index % 2 === 0 ? "erp-user-1" : "erp-user-2",
      assertion: index % 2 === 0 ? "assertion-user-1" : "assertion-user-2",
      requestId: `load-tab-${index % 5}-request-${index}`,
    }));

    const responses = await Promise.all(expected.map((item) =>
      handle(callWhoAmI(item.assertion, item.requestId))));
    const payloads = await Promise.all(responses.map((response) => response.json()));

    payloads.forEach((payload, index) => {
      expect(payload.result.structuredContent.data.userId).toBe(expected[index].userId);
      expect(payload.result.structuredContent.meta.requestId).toBe(expected[index].requestId);
    });
    const audits = vi.mocked(deps.dataSource.writeAudit).mock.calls.map(([audit]) => audit);
    expect(audits).toHaveLength(40);
    expected.forEach((item) => {
      expect(audits).toContainEqual(expect.objectContaining({
        requestId: item.requestId,
        userId: item.userId,
      }));
    });
  });

  it("applies user disablement and role changes from the database immediately", async () => {
    const deps = dependencies();
    let current = { ...users["erp-user-1"] };
    vi.mocked(deps.dataSource.findUser!).mockImplementation(async () => current);
    const handle = createMcpRequestHandler(deps);

    const first = await handle(callWhoAmI("assertion-user-1", "role-before"));
    expect((await first.json()).result.structuredContent.data.role).toBe("SALES");

    current = { ...current, role: "PURCHASE", region: "总部", territories: [] };
    const second = await handle(callWhoAmI("assertion-user-1", "role-after"));
    expect((await second.json()).result.structuredContent.data).toMatchObject({
      userId: "erp-user-1",
      role: "PURCHASE",
      region: "总部",
    });

    current = { ...current, isActive: false };
    const disabled = await handle(callWhoAmI("assertion-user-1", "user-disabled"));
    expect(disabled.status).toBe(403);
    expect(deps.dataSource.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "user-disabled",
      userId: "erp-user-1",
      rejectionReason: "USER_DISABLED",
      success: false,
    }));
  });

  it("rejects an invalid assertion without trusting any claimed business identity", async () => {
    const deps = dependencies();
    const response = await createMcpRequestHandler(deps)(callWhoAmI(
      "tampered-token",
      "invalid-assertion-request",
    ));

    expect(response.status).toBe(401);
    expect(deps.dataSource.findUser).not.toHaveBeenCalled();
    expect(deps.dataSource.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "invalid-assertion-request",
      userId: "audit-user",
      rejectionReason: "ASSERTION_INVALID",
    }));
  });
});
