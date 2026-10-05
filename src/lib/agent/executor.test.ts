import { describe, expect, it, vi } from "vitest";
import { executeAgentTool, XIAOCHUAN_AUDIT_METHOD } from "@/lib/agent/executor";
import type { McpAuditInput, McpDataSource, McpUser } from "@/lib/mcp/application";

function buildUser(role: McpUser["role"] = "SUPER_ADMIN"): McpUser {
  return {
    id: "user-1",
    isActive: true,
    name: "测试用户",
    role,
    region: "山东",
    territories: [{ province: "山东省", cities: ["济南市"] }],
    viewScope: "TERRITORY",
  };
}

function buildDataSource(overrides: Partial<McpDataSource> = {}) {
  const execute = vi.fn(async () => ({ ok: true, rows: [] }));
  const writeAudit = vi.fn(async (_input: McpAuditInput) => undefined);
  const dataSource: McpDataSource = { execute, writeAudit, ...overrides };
  return { dataSource, execute, writeAudit };
}

describe("executeAgentTool", () => {
  it("成功执行并写入审计", async () => {
    const { dataSource, execute, writeAudit } = buildDataSource();
    const outcome = await executeAgentTool({
      dataSource,
      user: buildUser(),
      toolName: "crm_products_list",
      args: {},
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.data).toEqual({ ok: true, rows: [] });
    expect(execute).toHaveBeenCalledWith(
      "crm_products_list",
      expect.objectContaining({ page: 1, pageSize: 20 }),
      expect.objectContaining({ id: "user-1" }),
    );
    expect(writeAudit).toHaveBeenCalledTimes(1);
    const audit = writeAudit.mock.calls[0]?.[0];
    expect(audit).toBeDefined();
    expect(audit).toMatchObject({
      userId: "user-1",
      apiKeyName: "xiaochuan-in-app",
      method: XIAOCHUAN_AUDIT_METHOD,
      toolName: "crm_products_list",
      success: true,
      statusCode: 200,
    });
  });

  it("白名单外的工具直接拒绝，不触达数据源", async () => {
    const { dataSource, execute } = buildDataSource();
    const outcome = await executeAgentTool({
      dataSource,
      user: buildUser(),
      toolName: "delete_all_customers",
      args: {},
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).toBe("TOOL_NOT_ALLOWED");
    expect(execute).not.toHaveBeenCalled();
  });

  it("角色无权时拒绝（销售不能查 AI 线索池）", async () => {
    const { dataSource, execute } = buildDataSource();
    const outcome = await executeAgentTool({
      dataSource,
      user: buildUser("SALES"),
      toolName: "lead_list",
      args: {},
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).toBe("FORBIDDEN");
    expect(execute).not.toHaveBeenCalled();
  });

  it("参数不符合 schema 时返回 INVALID_ARGUMENT，不触达数据源", async () => {
    const { dataSource, execute } = buildDataSource();
    const outcome = await executeAgentTool({
      dataSource,
      user: buildUser(),
      toolName: "crm_customers_list",
      args: { pageSize: 5_000 },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).toBe("INVALID_ARGUMENT");
    expect(execute).not.toHaveBeenCalled();
  });

  it("查询超时返回 QUERY_TIMEOUT", async () => {
    const { dataSource } = buildDataSource({
      execute: () => new Promise(() => undefined),
    });
    const outcome = await executeAgentTool({
      dataSource,
      user: buildUser(),
      toolName: "crm_products_list",
      args: {},
      timeoutMs: 20,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).toBe("QUERY_TIMEOUT");
  });

  it("审计写入失败时不交付查询结果", async () => {
    const { dataSource, execute } = buildDataSource({
      writeAudit: async () => {
        throw new Error("audit down");
      },
    });
    const outcome = await executeAgentTool({
      dataSource,
      user: buildUser(),
      toolName: "crm_products_list",
      args: {},
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).toBe("AUDIT_UNAVAILABLE");
    expect(outcome.data).toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("数据源抛出普通错误时返回 INTERNAL_ERROR 并记录失败审计", async () => {
    const { dataSource, writeAudit } = buildDataSource({
      execute: async () => {
        throw new Error("boom");
      },
    });
    const outcome = await executeAgentTool({
      dataSource,
      user: buildUser(),
      toolName: "crm_products_list",
      args: {},
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).toBe("INTERNAL_ERROR");
    const audit = writeAudit.mock.calls[0]?.[0];
    expect(audit?.success).toBe(false);
    expect(audit?.statusCode).toBe(500);
  });
});

describe("executeAgentTool：内置知识工具", () => {
  it("机型查询成功执行（无角色限制）并写审计，不触达 MCP 数据源", async () => {
    const { dataSource, execute, writeAudit } = buildDataSource();
    const knowledgeRunner = vi.fn(async () => ({ total: 1, returned: 1, machines: [{ model: "BK5040" }] }));
    const outcome = await executeAgentTool({
      dataSource,
      user: buildUser("SALES"),
      toolName: "dachuan_knowledge_machine_search",
      args: { model: "BK5040" },
      knowledgeRunner,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.data).toMatchObject({ total: 1 });
    expect(knowledgeRunner).toHaveBeenCalledWith("dachuan_knowledge_machine_search", { model: "BK5040" });
    expect(execute).not.toHaveBeenCalled();
    const audit = writeAudit.mock.calls[0]?.[0];
    expect(audit).toMatchObject({
      userId: "user-1",
      toolName: "dachuan_knowledge_machine_search",
      success: true,
      statusCode: 200,
      method: XIAOCHUAN_AUDIT_METHOD,
    });
  });

  it("未注入 knowledgeRunner 时走默认知识查询（绕过 prisma 由 queries 惰性处理，这里仅验证分支通路）", async () => {
    const { dataSource } = buildDataSource();
    const outcome = await executeAgentTool({
      dataSource,
      user: buildUser(),
      toolName: "dachuan_knowledge_process_rules",
      args: {},
      // 不传 knowledgeRunner：queries.runKnowledgeTool 内部动态 import @/lib/db，
      // 在测试环境可能因缺 DATABASE_URL 失败，但只要走完审计分支即证明白名单放行
      timeoutMs: 50,
    });
    // ok 或报错皆可，关键是不能是 TOOL_NOT_ALLOWED（说明知识工具在白名单内）
    expect(outcome.errorCode).not.toBe("TOOL_NOT_ALLOWED");
  });

  it("知识工具参数不符合 schema 时返回 INVALID_ARGUMENT，不执行查询", async () => {
    const { dataSource } = buildDataSource();
    const knowledgeRunner = vi.fn(async () => ({}));
    const outcome = await executeAgentTool({
      dataSource,
      user: buildUser(),
      toolName: "dachuan_knowledge_nc_program",
      args: { system: "FANUC" },
      knowledgeRunner,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).toBe("INVALID_ARGUMENT");
    expect(knowledgeRunner).not.toHaveBeenCalled();
  });

  it("知识查询抛错时返回 INTERNAL_ERROR 并记失败审计", async () => {
    const { dataSource, writeAudit } = buildDataSource();
    const outcome = await executeAgentTool({
      dataSource,
      user: buildUser(),
      toolName: "dachuan_knowledge_machine_search",
      args: {},
      knowledgeRunner: async () => {
        throw new Error("db down");
      },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).toBe("INTERNAL_ERROR");
    const audit = writeAudit.mock.calls[0]?.[0];
    expect(audit?.success).toBe(false);
  });

  it("知识库审计失败时同样不交付查询结果", async () => {
    const { dataSource } = buildDataSource({
      writeAudit: async () => {
        throw new Error("audit down");
      },
    });
    const outcome = await executeAgentTool({
      dataSource,
      user: buildUser(),
      toolName: "dachuan_knowledge_machine_search",
      args: {},
      knowledgeRunner: async () => ({ total: 0, machines: [] }),
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).toBe("AUDIT_UNAVAILABLE");
    expect(outcome.data).toBeUndefined();
  });
});
