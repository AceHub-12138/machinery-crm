import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createMcpRequestHandler, type McpApplicationDependencies } from "@/lib/mcp/application";
import { LeadWriterRateLimitError } from "@/lib/agent-auth/service-runtime";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sourceUrlOfLength(length: number) {
  const prefix = "https://example.com/";
  return `${prefix}${"a".repeat(length - prefix.length)}`;
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://mcp-write.example.com/api/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: "Bearer command-secret",
      "content-type": "application/json",
      host: "mcp-write.example.com",
      "x-dachuan-request-id": "lead-write-request-1",
      "x-dachuan-service-assertion": "service-assertion-1",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function dependencies() {
  return {
    config: {
      apiKeys: [{ name: "lead-ingestor", keyHash: sha256("command-secret") }],
      rejectedAuditUserId: "audit-user-1",
      allowedHosts: ["mcp-write.example.com"],
      allowedOrigins: [],
      toolMode: "lead-write-internal",
      allowedCommandToolNames: ["lead_upsert"],
      allowedServicePrincipalIds: ["ai-lead-ingestor"],
      queryTimeoutMs: 100,
    },
    serviceIdentityVerifier: {
      verify: vi.fn().mockResolvedValue({
        principalType: "SERVICE",
        principalId: "ai-lead-ingestor",
        scopes: ["lead:create"],
        jti: "service-jti-1",
      }),
    },
    dataSource: {
      execute: vi.fn(),
      executeCommand: vi.fn().mockResolvedValue({
        items: [{
          id: "lead-1",
          replay: false,
          writeDisposition: "CREATED",
          routingOutcome: "ASSIGNED",
        }],
      }),
      writeAudit: vi.fn().mockResolvedValue(undefined),
    },
    now: () => new Date("2026-08-14T08:00:00.000Z"),
  } as unknown as McpApplicationDependencies;
}

describe("LEAD_WRITE_INTERNAL MCP mode", () => {
  it("publishes only lead_upsert and executes it through the command interface", async () => {
    const deps = dependencies();
    const handle = createMcpRequestHandler(deps);
    const listResponse = await handle(request({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }));
    const list = await listResponse.json();

    expect(list.result.tools).toEqual([
      expect.objectContaining({
        name: "lead_upsert",
        annotations: expect.objectContaining({
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        }),
      }),
    ]);

    const callResponse = await handle(request({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "lead_upsert",
        arguments: {
          items: [{
            idempotencyKey: "lead-import-20260814-0001",
            payloadHash: "a".repeat(64),
            companyName: "山东测试机床有限公司",
            source: "BAIDU_SEARCH",
          }],
        },
      },
    }));
    const call = await callResponse.json();

    expect(call.result.structuredContent).toMatchObject({
      ok: true,
      data: { items: [{
        id: "lead-1",
        replay: false,
        writeDisposition: "CREATED",
        routingOutcome: "ASSIGNED",
      }] },
    });
    expect(deps.dataSource.execute).not.toHaveBeenCalled();
    expect(deps.dataSource.executeCommand).toHaveBeenCalledWith(
      "lead_upsert",
      expect.objectContaining({ items: [expect.objectContaining({ companyName: "山东测试机床有限公司" })] }),
      expect.objectContaining({
        requestId: "lead-write-request-1",
        principal: expect.objectContaining({ principalType: "SERVICE", principalId: "ai-lead-ingestor" }),
      }),
    );
  });

  it("accepts the complete bounded Lead payload without silently dropping business fields", async () => {
    const deps = dependencies();
    const handle = createMcpRequestHandler(deps);
    const item = {
      idempotencyKey: "lead-import-20260814-0002",
      payloadHash: "b".repeat(64),
      companyName: "山东完整字段测试有限公司",
      contactName: "张经理",
      phone: "+86 138-0000-0000",
      email: "lead@example.com",
      source: "BAIDU_SEARCH",
      sourceUrl: "https://example.com/leads/2",
      searchKeyword: "数控龙门加工中心",
      aiScore: 88,
      profile: { industry: "机械制造", intent: "设备询价" },
      sourceModelVersion: "lead-model-2026-08",
      extractorVersion: "extractor-3",
      sourceSystem: "internal-crawler",
      externalLeadId: "crawler-2",
    };

    const response = await handle(request({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "lead_upsert", arguments: { items: [item] } },
    }));
    const payload = await response.json();

    expect(payload.result.structuredContent.ok).toBe(true);
    expect(deps.dataSource.executeCommand).toHaveBeenCalledWith(
      "lead_upsert",
      { items: [item] },
      expect.any(Object),
    );
  });

  it("accepts and preserves a standard province/city profile", async () => {
    const deps = dependencies();
    const handle = createMcpRequestHandler(deps);
    const item = {
      idempotencyKey: "lead-import-standard-region",
      payloadHash: "9".repeat(64),
      companyName: "江阴标准地区测试有限公司",
      source: "BAIDU_SEARCH",
      profile: { industry: "锻件制造", province: "江苏省", city: "无锡市" },
    };
    const response = await handle(request({
      jsonrpc: "2.0",
      id: "standard-region",
      method: "tools/call",
      params: { name: "lead_upsert", arguments: { items: [item] } },
    }));
    const payload = await response.json();

    expect(payload.result.structuredContent.ok).toBe(true);
    expect(deps.dataSource.executeCommand).toHaveBeenCalledWith("lead_upsert", { items: [item] }, expect.any(Object));
  });

  it.each([
    ["省份简称", { province: "江苏" }],
    ["缺少 province", { city: "无锡市" }],
    ["非法省市组合", { province: "江苏省", city: "广州市" }],
  ])("rejects a profile with %s before command execution", async (_label, profile) => {
    const deps = dependencies();
    const handle = createMcpRequestHandler(deps);
    const response = await handle(request({
      jsonrpc: "2.0",
      id: "invalid-region",
      method: "tools/call",
      params: {
        name: "lead_upsert",
        arguments: {
          items: [{
            idempotencyKey: "lead-import-invalid-region",
            payloadHash: "8".repeat(64),
            companyName: "非法地区测试有限公司",
            source: "BAIDU_SEARCH",
            profile,
          }],
        },
      },
    }));
    const payload = await response.json();

    expect(payload.result.isError).toBe(true);
    expect(payload.result.structuredContent).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(deps.dataSource.executeCommand).not.toHaveBeenCalled();
  });

  it.each([191, 192, 2_048])("accepts a valid sourceUrl with %i characters unchanged", async (length) => {
    const deps = dependencies();
    const handle = createMcpRequestHandler(deps);
    const sourceUrl = sourceUrlOfLength(length);
    const item = {
      idempotencyKey: `lead-import-source-url-${length}`,
      payloadHash: "c".repeat(64),
      companyName: `来源链接边界测试 ${length}`,
      source: "BAIDU_SEARCH",
      sourceUrl,
    };

    const response = await handle(request({
      jsonrpc: "2.0",
      id: `source-url-${length}`,
      method: "tools/call",
      params: { name: "lead_upsert", arguments: { items: [item] } },
    }));
    const payload = await response.json();

    expect(payload.result.structuredContent.ok).toBe(true);
    expect(deps.dataSource.executeCommand).toHaveBeenCalledWith(
      "lead_upsert",
      { items: [item] },
      expect.any(Object),
    );
  });

  it.each([
    ["2049 字符", sourceUrlOfLength(2_049)],
    ["非 HTTP(S) URL", "ftp://example.com/lead"],
    ["非法 URL", "not-a-url"],
    ["会被 trim 改写的 URL", " https://example.com/lead "],
  ])("rejects %s as INVALID_ARGUMENT", async (_label, sourceUrl) => {
    const deps = dependencies();
    const handle = createMcpRequestHandler(deps);
    const response = await handle(request({
      jsonrpc: "2.0",
      id: "source-url-invalid",
      method: "tools/call",
      params: {
        name: "lead_upsert",
        arguments: {
          items: [{
            idempotencyKey: "lead-import-source-url-invalid",
            payloadHash: "d".repeat(64),
            companyName: "非法来源链接测试",
            source: "BAIDU_SEARCH",
            sourceUrl,
          }],
        },
      },
    }));
    const payload = await response.json();

    expect(payload.result.isError).toBe(true);
    expect(payload.result.structuredContent).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(deps.dataSource.executeCommand).not.toHaveBeenCalled();
  });

  it("rejects a human SUPER_ADMIN assertion before the command interface", async () => {
    const deps = dependencies();
    const handle = createMcpRequestHandler(deps);
    const response = await handle(request({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "lead_upsert", arguments: { items: [] } },
    }, {
      "x-dachuan-service-assertion": "",
      "x-dachuan-user-assertion": "human-super-admin-assertion",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: "Missing X-Dachuan-Service-Assertion" } });
    expect(deps.serviceIdentityVerifier?.verify).not.toHaveBeenCalled();
    expect(deps.dataSource.executeCommand).not.toHaveBeenCalled();
  });

  it("rejects a SERVICE principal without lead:create scope", async () => {
    const deps = dependencies();
    vi.mocked(deps.serviceIdentityVerifier!.verify).mockResolvedValueOnce({
      principalType: "SERVICE",
      principalId: "ai-lead-ingestor",
      scopes: ["lead:read"],
      jti: "jti-read-only",
    });
    const handle = createMcpRequestHandler(deps);
    const response = await handle(request({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "lead_upsert",
        arguments: {
          items: [{
            idempotencyKey: "lead-import-20260814-0005",
            payloadHash: "d".repeat(64),
            companyName: "无权限服务测试",
            source: "OTHER",
          }],
        },
      },
    }));
    const payload = await response.json();

    expect(payload.result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "INSUFFICIENT_SCOPE" },
    });
    expect(deps.dataSource.executeCommand).not.toHaveBeenCalled();
  });

  it("rejects a SERVICE principal outside the explicit principal allowlist", async () => {
    const deps = dependencies();
    vi.mocked(deps.serviceIdentityVerifier!.verify).mockResolvedValueOnce({
      principalType: "SERVICE",
      principalId: "unapproved-service",
      scopes: ["lead:create"],
      jti: "jti-unapproved",
    });
    const handle = createMcpRequestHandler(deps);
    const response = await handle(request({
      jsonrpc: "2.0",
      id: 51,
      method: "tools/call",
      params: {
        name: "lead_upsert",
        arguments: {
          items: [{
            idempotencyKey: "lead-import-20260814-0051",
            payloadHash: "d".repeat(64),
            companyName: "白名单外服务测试",
            source: "OTHER",
          }],
        },
      },
    }));
    const payload = await response.json();

    expect(payload.result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "SERVICE_PRINCIPAL_NOT_ALLOWED" },
    });
    expect(deps.dataSource.executeCommand).not.toHaveBeenCalled();
  });

  it("returns 429 when the independent service rate limit is exhausted", async () => {
    const deps = dependencies();
    vi.mocked(deps.serviceIdentityVerifier!.verify).mockRejectedValueOnce(new LeadWriterRateLimitError());
    const handle = createMcpRequestHandler(deps);
    const response = await handle(request({
      jsonrpc: "2.0",
      id: 52,
      method: "tools/call",
      params: { name: "lead_upsert", arguments: { items: [] } },
    }));

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { message: "Lead writer rate limit exceeded" } });
    expect(deps.dataSource.executeCommand).not.toHaveBeenCalled();
  });

  it.each([
    ["空公司名", { companyName: "" }],
    ["非法电话", { phone: "not-a-phone" }],
    ["非法邮箱", { email: "not-an-email" }],
    ["非法枚举", { source: "UNKNOWN_SOURCE" }],
    ["评分越界", { aiScore: 101 }],
    ["敏感画像字段", { profile: { systemPrompt: "完整提示词" } }],
    ["越权业务字段", { assignedUserId: "user-1" }],
    ["null 业务字段", { phone: null }],
  ])("strictly rejects %s without executing a command", async (_label, mutation) => {
    const deps = dependencies();
    const handle = createMcpRequestHandler(deps);
    const item = {
      idempotencyKey: "lead-import-20260814-invalid",
      payloadHash: "e".repeat(64),
      companyName: "严格校验测试公司",
      source: "OTHER",
      ...mutation,
    };
    const response = await handle(request({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "lead_upsert", arguments: { items: [item] } },
    }));
    const payload = await response.json();

    expect(payload.result.structuredContent).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(deps.dataSource.executeCommand).not.toHaveBeenCalled();
  });

  it("rejects batches above 20 items", async () => {
    const deps = dependencies();
    const handle = createMcpRequestHandler(deps);
    const items = Array.from({ length: 21 }, (_, index) => ({
      idempotencyKey: `lead-import-20260814-${String(index).padStart(4, "0")}`,
      payloadHash: "f".repeat(64),
      companyName: `批量限制测试公司 ${index}`,
      source: "OTHER",
    }));
    const response = await handle(request({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "lead_upsert", arguments: { items } },
    }));
    const payload = await response.json();

    expect(payload.result.structuredContent).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(deps.dataSource.executeCommand).not.toHaveBeenCalled();
  });
});
