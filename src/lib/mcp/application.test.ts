import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { describe, expect, it, vi } from "vitest";
import { createMcpRequestHandler, type McpApplicationDependencies } from "@/lib/mcp/application";
import { createPrismaMcpDataSource } from "@/lib/mcp/prisma-data-source";

const user = {
  id: "user-1",
  name: "测试管理员",
  email: "admin@example.com",
  role: "SUPER_ADMIN" as const,
  region: "全国",
  territories: [],
  viewScope: "ALL",
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function createDependencies(): McpApplicationDependencies {
  return {
    config: {
      apiKeys: [{ name: "fastgpt-test", keyHash: sha256("test-secret") }],
      rejectedAuditUserId: "audit-user-1",
      allowedHosts: ["mcp.example.com"],
      allowedOrigins: [],
      legacyUserBindingEnabled: false,
      toolMode: "full-read-only",
      allowedBusinessToolNames: ["crm_customers_list", "erp_inventory_list"],
      allowedBusinessToolRoles: ["SUPER_ADMIN"],
      queryTimeoutMs: 100,
    },
    identityVerifier: { verify: vi.fn().mockResolvedValue({ userId: user.id, jti: "jti-1" }) },
    dataSource: {
      findUser: vi.fn().mockResolvedValue(user),
      execute: vi.fn(),
      writeAudit: vi.fn().mockResolvedValue(undefined),
    },
    now: () => new Date("2026-07-17T08:00:00.000Z"),
  };
}

function mcpRequest(body: unknown, token = "test-secret") {
  return new Request("https://mcp.example.com/api/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      host: "mcp.example.com",
      "x-dachuan-request-id": "request-1",
      "x-dachuan-user-assertion": "assertion-1",
    },
    body: JSON.stringify(body),
  });
}

async function handleWithSdkPayload(
  dependencies: McpApplicationDependencies,
  payload: unknown,
  toolName = "crm_customers_list",
) {
  const handleRequest = vi.spyOn(WebStandardStreamableHTTPServerTransport.prototype, "handleRequest")
    .mockResolvedValueOnce(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    }));
  try {
    return await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 601,
      method: "tools/call",
      params: { name: toolName, arguments: {} },
    }));
  } finally {
    handleRequest.mockRestore();
  }
}

describe("DachuanPro MCP request handler", () => {
  it("authenticates an API key, completes MCP initialization, and audits the call", async () => {
    const dependencies = createDependencies();
    const handle = createMcpRequestHandler(dependencies);

    const response = await handle(mcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "FastGPT-MCP-client", version: "1.0.0" },
      },
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.serverInfo).toMatchObject({
      name: "dachuanpro-crm-erp",
      version: "1.0.0",
    });
    expect(dependencies.dataSource.findUser).not.toHaveBeenCalled();
    expect(dependencies.dataSource.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "request-1",
      userId: "audit-user-1",
      apiKeyName: "fastgpt-test",
      method: "initialize",
      success: true,
    }));
  });

  it("publishes only the configured business-tool allowlist plus identity", async () => {
    const dependencies = createDependencies();
    const handle = createMcpRequestHandler(dependencies);

    const response = await handle(mcpRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "dachuan_identity_who_am_i",
      "crm_customers_list",
      "erp_inventory_list",
    ]);
    expect(payload.result.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "erp_inventory_list",
        annotations: expect.objectContaining({ readOnlyHint: true, destructiveHint: false }),
      }),
    ]));
    const customerTool = payload.result.tools.find((tool: { name: string }) => tool.name === "crm_customers_list");
    expect(customerTool).toMatchObject({
      description: expect.stringContaining("某日期范围内新增客户"),
      inputSchema: {
        properties: expect.objectContaining({
          customerType: expect.objectContaining({ enum: ["NEW", "OLD", "AGENT", "END_USER", "DISTRIBUTOR"] }),
          status: expect.objectContaining({ enum: ["NEW_LEAD", "CONTACTED", "QUOTED", "NEGOTIATING", "WON", "LOST", "INACTIVE"] }),
        }),
      },
    });
    expect(dependencies.dataSource.execute).not.toHaveBeenCalled();
  });

  it("publishes the read-only lead list tool with the approved filters", async () => {
    const dependencies = createDependencies();
    dependencies.config.allowedBusinessToolNames = ["lead_list"];
    const response = await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/list",
      params: {},
    }));

    const payload = await response.json();
    const leadList = payload.result.tools.find((tool: { name: string }) => tool.name === "lead_list");

    expect(payload.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "dachuan_identity_who_am_i",
      "lead_list",
    ]);
    expect(leadList).toMatchObject({
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        properties: expect.objectContaining({
          reviewStatus: expect.objectContaining({
            enum: ["PENDING", "HIGH_INTENT", "MID_INTENT", "LOW_INTENT", "INVALID"],
          }),
          source: expect.objectContaining({ enum: ["BAIDU_SEARCH", "MANUAL", "OTHER"] }),
          searchKeyword: expect.any(Object),
          aiScoreMin: expect.any(Object),
          aiScoreMax: expect.any(Object),
          dateStart: expect.any(Object),
          dateEnd: expect.any(Object),
          page: expect.any(Object),
          pageSize: expect.any(Object),
        }),
      },
    });
  });

  it("rejects a non-UUID lead detail id with a field-level message", async () => {
    const dependencies = createDependencies();
    dependencies.config.allowedBusinessToolNames = ["lead_get"];
    const response = await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 211,
      method: "tools/call",
      params: { name: "lead_get", arguments: { id: "12" } },
    }));

    const payload = await response.json();
    expect(payload.result).toMatchObject({
      isError: true,
      structuredContent: {
        error: { code: "INVALID_ARGUMENT" },
        meta: { tool: "lead_get" },
      },
    });
    expect(payload.result.structuredContent.error.message).toContain("id:");
    expect(dependencies.dataSource.execute).not.toHaveBeenCalled();
  });

  it("rejects inverted lead score bounds with a field-level message", async () => {
    const dependencies = createDependencies();
    dependencies.config.allowedBusinessToolNames = ["lead_list"];
    const response = await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 212,
      method: "tools/call",
      params: { name: "lead_list", arguments: { aiScoreMin: 90, aiScoreMax: 60 } },
    }));

    const payload = await response.json();
    expect(payload.result.structuredContent.error).toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(payload.result.structuredContent.error.message).toContain("aiScoreMin:");
    expect(dependencies.dataSource.execute).not.toHaveBeenCalled();
  });

  it("enforces the lead tool's SUPER_ADMIN role even when the caller role is globally allowed", async () => {
    const dependencies = createDependencies();
    dependencies.config.allowedBusinessToolNames = ["lead_list"];
    dependencies.config.allowedBusinessToolRoles = ["SUPER_ADMIN", "SALES"];
    if (!dependencies.dataSource.findUser) throw new Error("test data source must provide findUser");
    vi.mocked(dependencies.dataSource.findUser).mockResolvedValue({ ...user, role: "SALES" });
    const response = await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 213,
      method: "tools/call",
      params: { name: "lead_list", arguments: {} },
    }));

    const payload = await response.json();
    expect(payload.result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "FORBIDDEN" } },
    });
    expect(dependencies.dataSource.execute).not.toHaveBeenCalled();
  });

  it("rejects a business tool that is not in the configured allowlist", async () => {
    const dependencies = createDependencies();
    const response = await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: { name: "crm_contracts_list", arguments: {} },
    }));

    const payload = await response.json();
    expect(response.status).toBe(403);
    expect(payload).toMatchObject({
      error: { code: -32003, message: "MCP tool is not enabled" },
    });
    expect(dependencies.dataSource.findUser).not.toHaveBeenCalled();
    expect(dependencies.dataSource.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["WAREHOUSE", "erp_inventory_list"],
    ["SALES", "crm_customers_list"],
  ] as const)("rejects %s from calling a permitted tool outside the configured caller allowlist", async (role, toolName) => {
    const dependencies = createDependencies();
    if (!dependencies.dataSource.findUser) throw new Error("test data source must provide findUser");
    vi.mocked(dependencies.dataSource.findUser).mockResolvedValue({ ...user, role });
    const response = await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 23,
      method: "tools/call",
      params: { name: toolName, arguments: {} },
    }));

    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.result.structuredContent).toMatchObject({
      ok: false,
      meta: { tool: toolName },
      error: { code: "FORBIDDEN" },
    });
    expect(dependencies.dataSource.execute).not.toHaveBeenCalled();
  });

  it("returns the uniform FastGPT-friendly envelope for a tool call", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.dataSource.execute).mockResolvedValue({
      items: [{ id: "customer-1", companyName: "测试客户" }],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    const handle = createMcpRequestHandler(dependencies);

    const response = await handle(mcpRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "crm_customers_list",
        arguments: { page: 1, pageSize: 20, search: "测试" },
      },
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.structuredContent).toEqual({
      ok: true,
      data: {
        items: [{ id: "customer-1", companyName: "测试客户" }],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      },
      meta: {
        requestId: "request-1",
        tool: "crm_customers_list",
        generatedAt: "2026-07-17T08:00:00.000Z",
      },
      error: null,
    });
    expect(payload.result.content[0]).toMatchObject({ type: "text" });
    expect(dependencies.dataSource.execute).toHaveBeenCalledWith(
      "crm_customers_list",
      { page: 1, pageSize: 20, search: "测试" },
      user,
    );
    expect(dependencies.dataSource.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      method: "tools/call",
      toolName: "crm_customers_list",
      success: true,
    }));
  });

  it("rejects an invalid API key before any CRM or ERP query", async () => {
    const dependencies = createDependencies();
    const handle = createMcpRequestHandler(dependencies);

    const response = await handle(mcpRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/list",
      params: {},
    }, "wrong-secret"));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: -32001, message: "Invalid MCP API key" },
    });
    expect(dependencies.dataSource.findUser).not.toHaveBeenCalled();
    expect(dependencies.dataSource.execute).not.toHaveBeenCalled();
    expect(dependencies.dataSource.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: "audit-user-1",
      apiKeyName: "[key-rejected]",
      success: false,
      statusCode: 401,
    }));
  });

  it("fails closed when an authenticated call cannot be written to the audit log", async () => {
    const dependencies = createDependencies();
    dependencies.config.diagnosticLogging = true;
    vi.mocked(dependencies.dataSource.writeAudit).mockRejectedValue(new Error("database unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const handle = createMcpRequestHandler(dependencies);

    const response = await handle(mcpRequest({ jsonrpc: "2.0", id: 5, method: "tools/list", params: {} }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { message: "MCP audit log is unavailable" } });
    expect(warn).toHaveBeenCalledWith(JSON.stringify({
      event: "MCP_AUDIT_DIAGNOSTIC",
      requestId: "request-1",
      method: "tools/list",
      toolName: undefined,
      outcome: "ERROR",
      durationMs: 0,
      errorName: "Error",
      errorCode: "UNAVAILABLE",
    }));
    warn.mockRestore();
  });

  it("writes a redacted audit-success diagnostic only when explicitly enabled", async () => {
    const dependencies = createDependencies();
    dependencies.config.diagnosticLogging = true;
    vi.mocked(dependencies.dataSource.execute).mockResolvedValue({ items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "crm_customers_list", arguments: {} },
    }));

    expect(response.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"event":"MCP_AUDIT_DIAGNOSTIC"'));
    const entries = warn.mock.calls
      .map(([entry]) => typeof entry === "string" ? JSON.parse(entry) : null)
      .filter((entry): entry is Record<string, unknown> => entry?.event === "MCP_AUDIT_DIAGNOSTIC");
    expect(entries).toEqual([{
      event: "MCP_AUDIT_DIAGNOSTIC",
      requestId: "request-1",
      method: "tools/call",
      toolName: "crm_customers_list",
      outcome: "SUCCESS",
      durationMs: 0,
      responseStatus: 200,
    }]);
    warn.mockRestore();
  });

  it("works through the same Streamable HTTP SDK client used by FastGPT 4.15.1", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.dataSource.execute).mockResolvedValue({ items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    const handle = createMcpRequestHandler(dependencies);
    const transport = new StreamableHTTPClientTransport(new URL("https://mcp.example.com/api/mcp"), {
      requestInit: { headers: { authorization: "Bearer test-secret" } },
      fetch: async (input, init) => {
        const original = new Request(input, init);
        const headers = new Headers(original.headers);
        headers.set("host", "mcp.example.com");
        headers.set("x-dachuan-request-id", `sdk-request-${original.method}-${Date.now()}`);
        headers.set("x-dachuan-user-assertion", "assertion-1");
        return handle(new Request(original, { headers }));
      },
    });
    const client = new Client({ name: "FastGPT-MCP-client", version: "4.15.1" }, { capabilities: {} });

    await client.connect(transport);
    const catalog = await client.listTools();
    const result = await client.callTool({ name: "crm_customers_list", arguments: { page: 1, pageSize: 20 } });
    await client.close();

    expect(catalog.tools.map((tool) => tool.name)).toEqual([
      "dachuan_identity_who_am_i",
      "crm_customers_list",
      "erp_inventory_list",
    ]);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ ok: true, meta: { tool: "crm_customers_list" } });
  });

  it("normalizes SDK argument-validation failures into the uniform tool envelope", async () => {
    const dependencies = createDependencies();
    const handle = createMcpRequestHandler(dependencies);

    const response = await handle(mcpRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "crm_customers_list", arguments: { page: 0, pageSize: 1000 } },
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.result).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        data: null,
        meta: { requestId: "request-1", tool: "crm_customers_list" },
        error: { code: "INVALID_ARGUMENT" },
      },
    });
    expect(payload.result.structuredContent.error.message).toContain("page:");
    expect(payload.result.structuredContent.error.message).toContain("pageSize:");
    expect(dependencies.dataSource.execute).not.toHaveBeenCalled();
    expect(dependencies.dataSource.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it("extracts an SDK tool-error content message without retaining rejected input values", async () => {
    const dependencies = createDependencies();
    dependencies.config.diagnosticLogging = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const rawMessage = "Input validation error: Invalid arguments for tool erp_inventory_list: "
      + JSON.stringify([{
        code: "invalid_format",
        path: ["warehouseId"],
        message: "Invalid UUID",
        input: "secret-warehouse-value",
      }]);

    const response = await handleWithSdkPayload(dependencies, {
      jsonrpc: "2.0",
      id: 601,
      result: { content: [{ type: "text", text: rawMessage }], isError: true },
    }, "erp_inventory_list");
    const payload = await response.json();

    expect(payload.result.structuredContent.error).toEqual({
      code: "INVALID_ARGUMENT",
      message: "warehouseId: Invalid UUID",
    });
    expect(JSON.stringify(payload)).not.toContain("secret-warehouse-value");
    expect(warn).toHaveBeenCalledWith(JSON.stringify({
      event: "MCP_RAW_TOOL_ERROR",
      requestId: "request-1",
      toolName: "erp_inventory_list",
      rawMessage: "Input validation error: Invalid arguments for tool erp_inventory_list: "
        + JSON.stringify([{ path: ["warehouseId"], message: "Invalid UUID" }]),
    }));
    warn.mockRestore();
  });

  it("extracts a -32602 RPC validation message", async () => {
    const dependencies = createDependencies();
    const rawMessage = "Input validation error: Invalid arguments for tool crm_customers_list: "
      + JSON.stringify([{
        code: "invalid_format",
        path: ["dateStart"],
        message: "Invalid ISO date",
        received: "2026/99/99",
      }]);

    const response = await handleWithSdkPayload(dependencies, {
      jsonrpc: "2.0",
      id: 601,
      error: { code: -32602, message: rawMessage },
    });
    const payload = await response.json();

    expect(payload.result.structuredContent.error).toEqual({
      code: "INVALID_ARGUMENT",
      message: "dateStart: Invalid ISO date",
    });
    expect(JSON.stringify(payload)).not.toContain("2026/99/99");
  });

  it("falls back to the existing generic message when SDK tool-error content is absent", async () => {
    const dependencies = createDependencies();
    const response = await handleWithSdkPayload(dependencies, {
      jsonrpc: "2.0",
      id: 601,
      result: { isError: true },
    });
    const payload = await response.json();

    expect(payload.result.structuredContent.error).toEqual({
      code: "INVALID_ARGUMENT",
      message: "工具参数无效或工具不存在",
    });
  });

  it("falls back without logging an unparseable validation payload that contains input values", async () => {
    const dependencies = createDependencies();
    dependencies.config.diagnosticLogging = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await handleWithSdkPayload(dependencies, {
      jsonrpc: "2.0",
      id: 601,
      result: {
        content: [{
          type: "text",
          text: "Input validation error: Invalid arguments for tool crm_customers_list: "
            + '{"input":"secret-customer-value","unexpected":true}',
        }],
        isError: true,
      },
    });
    const payload = await response.json();

    expect(payload.result.structuredContent.error.message).toBe("工具参数无效或工具不存在");
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("secret-customer-value"));
    warn.mockRestore();
  });

  it("logs cleaned arbitrary SDK error text when no input values are present", async () => {
    const dependencies = createDependencies();
    dependencies.config.diagnosticLogging = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await handleWithSdkPayload(dependencies, {
      jsonrpc: "2.0",
      id: 601,
      result: {
        content: [{ type: "text", text: "Lookup failed for alice@example.com" }],
        isError: true,
      },
    });
    const payload = await response.json();

    expect(payload.result.structuredContent.error.message).toBe("Lookup failed for alice@example.com");
    expect(warn).toHaveBeenCalledWith(JSON.stringify({
      event: "MCP_RAW_TOOL_ERROR",
      requestId: "request-1",
      toolName: "crm_customers_list",
      rawMessage: "Lookup failed for alice@example.com",
    }));
    warn.mockRestore();
  });

  it("identifies an unavailable SDK tool without hiding the original reason", async () => {
    const dependencies = createDependencies();
    dependencies.config.allowedBusinessToolNames = undefined;

    const response = await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 602,
      method: "tools/call",
      params: { name: "missing_tool", arguments: {} },
    }));
    const payload = await response.json();

    expect(payload.result.structuredContent.error).toEqual({
      code: "INVALID_ARGUMENT",
      message: "工具不可用：Tool missing_tool not found",
    });
  });

  it("removes control characters and truncates raw SDK error details to 300 characters", async () => {
    const dependencies = createDependencies();
    dependencies.config.diagnosticLogging = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await handleWithSdkPayload(dependencies, {
      jsonrpc: "2.0",
      id: 601,
      result: {
        content: [{
          type: "text",
          text: `Input validation error: Invalid arguments for tool crm_customers_list: \u0000${"x".repeat(400)}`,
        }],
        isError: true,
      },
    });
    const payload = await response.json();
    const message = payload.result.structuredContent.error.message as string;

    expect(message).toHaveLength(300);
    expect(message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(message).toBe("x".repeat(300));
    const rawDiagnostic = warn.mock.calls
      .map(([entry]) => JSON.parse(String(entry)))
      .find((entry) => entry.event === "MCP_RAW_TOOL_ERROR");
    expect(rawDiagnostic.rawMessage).toHaveLength(300);
    expect(rawDiagnostic.rawMessage).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    warn.mockRestore();
  });

  it("rejects a fabricated customer assignee UUID before data-source execution", async () => {
    const dependencies = createDependencies();
    const response = await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 60,
      method: "tools/call",
      params: { name: "crm_customers_list", arguments: { assignedUserId: "12" } },
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.result).toMatchObject({
      isError: true,
      structuredContent: {
        error: { code: "INVALID_ARGUMENT", message: expect.stringContaining("assignedUserId") },
      },
    });
    expect(dependencies.dataSource.execute).not.toHaveBeenCalled();
  });

  it("rejects a customer-type value mistakenly supplied as a lifecycle status before Prisma execution", async () => {
    const dependencies = createDependencies();
    const handle = createMcpRequestHandler(dependencies);

    const response = await handle(mcpRequest({
      jsonrpc: "2.0",
      id: 61,
      method: "tools/call",
      params: { name: "crm_customers_list", arguments: { status: "NEW" } },
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "INVALID_ARGUMENT",
        },
      },
    });
    expect(payload.result.structuredContent.error.message).toContain(
      "status 收到 NEW，这是 customerType 的值；查询某时间段新增客户时只需传日期范围，不要设置 status/customerType",
    );
    expect(dependencies.dataSource.execute).not.toHaveBeenCalled();
  });

  it("rejects a lifecycle status mistakenly supplied as customerType with a directional hint", async () => {
    const dependencies = createDependencies();
    const response = await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 611,
      method: "tools/call",
      params: { name: "crm_customers_list", arguments: { customerType: "NEW_LEAD" } },
    }));
    const payload = await response.json();

    expect(payload.result.structuredContent.error.code).toBe("INVALID_ARGUMENT");
    expect(payload.result.structuredContent.error.message).toContain(
      "customerType 收到 NEW_LEAD，这是 status 的值；查询某时间段新增客户时只需传日期范围，不要设置 status/customerType",
    );
    expect(dependencies.dataSource.execute).not.toHaveBeenCalled();
  });

  it("accepts a valid customer classification as its own typed filter", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.dataSource.execute).mockResolvedValue({ items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });

    const response = await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 62,
      method: "tools/call",
      params: { name: "crm_customers_list", arguments: { customerType: "NEW" } },
    }));

    expect(response.status).toBe(200);
    expect(dependencies.dataSource.execute).toHaveBeenCalledWith(
      "crm_customers_list",
      { customerType: "NEW", page: 1, pageSize: 20 },
      user,
    );
  });

  it("drops nullish optional customer filters before data-source execution", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.dataSource.execute).mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
    });

    const response = await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 621,
      method: "tools/call",
      params: {
        name: "crm_customers_list",
        arguments: {
          page: 1,
          pageSize: 100,
          dateStart: "2026-01-01",
          dateEnd: "2026-08-31",
          status: "null",
          province: "江苏省",
          city: "null",
          assignedUserId: "null",
        },
      },
    }));

    expect(response.status).toBe(200);
    expect(dependencies.dataSource.execute).toHaveBeenCalledWith(
      "crm_customers_list",
      {
        dateStart: "2026-01-01",
        dateEnd: "2026-08-31",
        province: "江苏省",
        page: 1,
        pageSize: 100,
      },
      user,
    );
  });

  it("drops every nullish placeholder variant from customer status and type", async () => {
    for (const field of ["status", "customerType"] as const) {
      for (const value of [undefined, null, "", "   ", "null", "UNDEFINED"]) {
        const dependencies = createDependencies();
        vi.mocked(dependencies.dataSource.execute).mockResolvedValue({
          items: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        });
        const response = await createMcpRequestHandler(dependencies)(mcpRequest({
          jsonrpc: "2.0",
          id: 6211,
          method: "tools/call",
          params: { name: "crm_customers_list", arguments: { [field]: value } },
        }));

        expect(response.status, `${field}=${String(value)}`).toBe(200);
        expect(dependencies.dataSource.execute).toHaveBeenCalledWith(
          "crm_customers_list",
          { page: 1, pageSize: 20 },
          user,
        );
      }
    }
  });

  it("drops nullish placeholders from optional boolean filters", async () => {
    for (const value of [undefined, null, "", "   ", "null", "UNDEFINED"]) {
      const inventoryDependencies = createDependencies();
      vi.mocked(inventoryDependencies.dataSource.execute).mockResolvedValue({
        items: [],
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      });
      const inventoryResponse = await createMcpRequestHandler(inventoryDependencies)(mcpRequest({
        jsonrpc: "2.0",
        id: 622,
        method: "tools/call",
        params: { name: "erp_inventory_list", arguments: { alertOnly: value } },
      }));

      const inventoryPayload = await inventoryResponse.json();
      expect(inventoryResponse.status, String(value)).toBe(200);
      expect(inventoryDependencies.dataSource.execute, JSON.stringify(inventoryPayload)).toHaveBeenCalledWith(
        "erp_inventory_list",
        { alertOnly: false, page: 1, pageSize: 20 },
        user,
      );

      const supplierDependencies = createDependencies();
      supplierDependencies.config.allowedBusinessToolNames?.push("erp_suppliers_list");
      vi.mocked(supplierDependencies.dataSource.execute).mockResolvedValue({
        items: [],
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      });
      const supplierResponse = await createMcpRequestHandler(supplierDependencies)(mcpRequest({
        jsonrpc: "2.0",
        id: 623,
        method: "tools/call",
        params: { name: "erp_suppliers_list", arguments: { active: value } },
      }));

      expect(supplierResponse.status, String(value)).toBe(200);
      expect(supplierDependencies.dataSource.execute).toHaveBeenCalledWith(
        "erp_suppliers_list",
        { page: 1, pageSize: 20 },
        user,
      );
    }
  });

  it("drops fabricated placeholder values from optional customer locations", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.dataSource.execute).mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 1, total: 17, totalPages: 17 },
    });

    const response = await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 63,
      method: "tools/call",
      params: {
        name: "crm_customers_list",
        arguments: {
          dateStart: "2026-07-01",
          dateEnd: "2026-07-31",
          pageSize: 1,
          province: "1",
          city: "null",
        },
      },
    }));

    expect(response.status).toBe(200);
    expect(dependencies.dataSource.execute).toHaveBeenCalledWith(
      "crm_customers_list",
      {
        dateStart: "2026-07-01",
        dateEnd: "2026-07-31",
        page: 1,
        pageSize: 1,
      },
      user,
    );
  });

  it("treats null and blank customer locations as omitted filters", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.dataSource.execute).mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });

    const response = await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 631,
      method: "tools/call",
      params: {
        name: "crm_customers_list",
        arguments: { province: null, city: "   " },
      },
    }));

    expect(response.status).toBe(200);
    expect(dependencies.dataSource.execute).toHaveBeenCalledWith(
      "crm_customers_list",
      { page: 1, pageSize: 20 },
      user,
    );
  });

  it("normalizes only nullish search placeholders and preserves numeric searches", async () => {
    for (const placeholder of [null, "   ", "null", "UNDEFINED"]) {
      const dependencies = createDependencies();
      vi.mocked(dependencies.dataSource.execute).mockResolvedValue({
        items: [],
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      });
      const response = await createMcpRequestHandler(dependencies)(mcpRequest({
        jsonrpc: "2.0",
        id: 632,
        method: "tools/call",
        params: { name: "crm_customers_list", arguments: { search: placeholder } },
      }));

      expect(response.status).toBe(200);
      expect(dependencies.dataSource.execute).toHaveBeenCalledWith(
        "crm_customers_list",
        { page: 1, pageSize: 20 },
        user,
      );
    }

    const dependencies = createDependencies();
    vi.mocked(dependencies.dataSource.execute).mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
    const response = await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 633,
      method: "tools/call",
      params: { name: "crm_customers_list", arguments: { search: "12" } },
    }));

    expect(response.status).toBe(200);
    expect(dependencies.dataSource.execute).toHaveBeenCalledWith(
      "crm_customers_list",
      { search: "12", page: 1, pageSize: 20 },
      user,
    );
  });

  it("does not blacklist or map the semantic text 全部", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.dataSource.execute).mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
    const response = await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 634,
      method: "tools/call",
      params: {
        name: "crm_customers_list",
        arguments: { search: "全部", province: "全部", city: "全部" },
      },
    }));

    expect(response.status).toBe(200);
    expect(dependencies.dataSource.execute).toHaveBeenCalledWith(
      "crm_customers_list",
      { search: "全部", province: "全部", city: "全部", page: 1, pageSize: 20 },
      user,
    );
  });

  it("keeps regional sales isolation after customer placeholders are normalized", async () => {
    const salesUser = {
      ...user,
      role: "SALES" as const,
      region: "山东",
      territories: [{ province: "山东省", cities: ["济南市"] }],
      viewScope: "TERRITORY",
    };
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prismaDataSource = createPrismaMcpDataSource({
      customer: { findMany, count },
    } as never);
    const dependencies = createDependencies();
    dependencies.config.allowedBusinessToolRoles = ["SALES"];
    dependencies.dataSource = {
      ...prismaDataSource,
      findUser: vi.fn().mockResolvedValue(salesUser),
      writeAudit: vi.fn().mockResolvedValue(undefined),
    };

    const response = await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 635,
      method: "tools/call",
      params: {
        name: "crm_customers_list",
        arguments: { province: "1", city: "null" },
      },
    }));

    expect(response.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        deletedAt: null,
        businessLine: "国内销售",
        OR: [{ province: "山东省", city: { in: ["济南市"] } }],
      },
    }));
  });

  it("preserves explicit customer location and assignee filters", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.dataSource.execute).mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
    const assignedUserId = "123e4567-e89b-12d3-a456-426614174000";

    const response = await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 64,
      method: "tools/call",
      params: {
        name: "crm_customers_list",
        arguments: { province: "山东省", city: "济南市", assignedUserId },
      },
    }));

    expect(response.status).toBe(200);
    expect(dependencies.dataSource.execute).toHaveBeenCalledWith(
      "crm_customers_list",
      {
        province: "山东省",
        city: "济南市",
        assignedUserId,
        page: 1,
        pageSize: 20,
      },
      user,
    );
  });

  it("limits application wait time and reports a query timeout without claiming SQL cancellation", async () => {
    const dependencies = createDependencies();
    dependencies.config.queryTimeoutMs = 10;
    vi.mocked(dependencies.dataSource.execute).mockImplementation(() => new Promise(() => undefined));
    const response = await createMcpRequestHandler(dependencies)(mcpRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "crm_customers_list", arguments: {} },
    }));
    const payload = await response.json();

    expect(payload.result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "QUERY_TIMEOUT" } },
    });
    expect(dependencies.dataSource.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});
