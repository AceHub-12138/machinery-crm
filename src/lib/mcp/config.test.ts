import { describe, expect, it } from "vitest";
import { loadMcpConfig } from "@/lib/mcp/config";

describe("MCP environment configuration", () => {
  it("loads only hashed API keys and explicit network allowlists", () => {
    const config = loadMcpConfig({
      NODE_ENV: "test",
      MCP_API_KEYS_JSON: JSON.stringify([
        {
          name: "fastgpt-prod",
          keyHash: `sha256:${"a".repeat(64)}`,
        },
      ]),
      MCP_AUDIT_USER_ID: "audit-user-1",
      MCP_ALLOWED_HOSTS: "mcp.dachuan.pro,localhost:3000",
      MCP_ALLOWED_ORIGINS: "https://fastgpt.dachuan.pro",
    });

    expect(config).toEqual({
      apiKeys: [{ name: "fastgpt-prod", keyHash: "a".repeat(64) }],
      rejectedAuditUserId: "audit-user-1",
      allowedHosts: ["mcp.dachuan.pro", "localhost:3000"],
      allowedOrigins: ["https://fastgpt.dachuan.pro"],
      legacyUserBindingEnabled: false,
      toolMode: "identity-poc",
      queryTimeoutMs: 5000,
      diagnosticLogging: false,
    });
  });

  it("enables diagnostic logging only when explicitly requested", () => {
    const baseEnvironment = {
      NODE_ENV: "test",
      MCP_API_KEYS_JSON: JSON.stringify([{ name: "fastgpt-prod", keyHash: "a".repeat(64) }]),
      MCP_AUDIT_USER_ID: "audit-user-1",
      MCP_ALLOWED_HOSTS: "localhost:3000",
    };

    expect(loadMcpConfig(baseEnvironment).diagnosticLogging).toBe(false);
    expect(loadMcpConfig({ ...baseEnvironment, MCP_DIAGNOSTIC_LOGGING: "true" }).diagnosticLogging).toBe(true);
    expect(loadMcpConfig({ ...baseEnvironment, MCP_DIAGNOSTIC_LOGGING: "TRUE" }).diagnosticLogging).toBe(false);
  });

  it("enables the old user-bound key path only with an explicit compatibility flag", () => {
    const config = loadMcpConfig({
      NODE_ENV: "test",
      MCP_API_KEYS_JSON: JSON.stringify([{ name: "test-only", userId: "user-1", keyHash: "b".repeat(64) }]),
      MCP_AUDIT_USER_ID: "audit-user-1",
      MCP_ALLOWED_HOSTS: "localhost:3000",
      MCP_LEGACY_USER_BOUND_AUTH: "true",
      MCP_TOOL_MODE: "IDENTITY_POC",
    });

    expect(config.legacyUserBindingEnabled).toBe(true);
    expect(config.toolMode).toBe("identity-poc");
    expect(config.apiKeys[0].userId).toBe("user-1");
  });

  it("refuses API-key-bound user identity in FULL_READ_ONLY even outside production", () => {
    expect(() => loadMcpConfig({
      NODE_ENV: "test",
      MCP_API_KEYS_JSON: JSON.stringify([{ name: "forbidden", userId: "user-1", keyHash: "d".repeat(64) }]),
      MCP_AUDIT_USER_ID: "audit-user-1",
      MCP_ALLOWED_HOSTS: "localhost:3000",
      MCP_LEGACY_USER_BOUND_AUTH: "true",
      MCP_TOOL_MODE: "FULL_READ_ONLY",
    })).toThrow(/must not contain business identity field userId/);
  });

  it("requires a non-empty, known business-tool allowlist in FULL_READ_ONLY mode", () => {
    const environment = {
      NODE_ENV: "test",
      MCP_API_KEYS_JSON: JSON.stringify([{ name: "readonly", keyHash: "d".repeat(64) }]),
      MCP_AUDIT_USER_ID: "audit-user-1",
      MCP_ALLOWED_HOSTS: "localhost:3000",
      MCP_TOOL_MODE: "FULL_READ_ONLY",
    };

    expect(() => loadMcpConfig(environment)).toThrow(/MCP_TOOL_ALLOWLIST is required/);
    expect(() => loadMcpConfig({ ...environment, MCP_TOOL_ALLOWLIST: "crm_customers_list,unknown_tool" })).toThrow(/unknown tool names/);
    expect(() => loadMcpConfig({ ...environment, MCP_TOOL_ALLOWLIST: "crm_customers_list" })).toThrow(/MCP_ALLOWED_CALLER_ROLES is required/);
    const twoToolEnvironment = {
      ...environment,
      MCP_TOOL_ALLOWLIST: "crm_customers_list,erp_inventory_list",
      MCP_ALLOWED_CALLER_ROLES: "SUPER_ADMIN",
    };
    expect(() => loadMcpConfig(twoToolEnvironment)).toThrow(/MCP_QUERY_DATABASE_URL is required/);
    expect(() => loadMcpConfig({
      ...twoToolEnvironment,
      MCP_QUERY_DATABASE_URL: "mysql://query:query-password@mysql:3306/machinery_crm",
    })).toThrow(/MCP_AUDIT_DATABASE_URL is required/);
    expect(() => loadMcpConfig({
      ...twoToolEnvironment,
      MCP_QUERY_DATABASE_URL: "not-a-url",
      MCP_AUDIT_DATABASE_URL: "mysql://audit:audit-password@mysql:3306/machinery_crm",
    })).toThrow(/MCP_QUERY_DATABASE_URL must be a valid MySQL URL/);
    expect(() => loadMcpConfig({
      ...twoToolEnvironment,
      MCP_QUERY_DATABASE_URL: "mysql://shared:query-password@mysql:3306/machinery_crm",
      MCP_AUDIT_DATABASE_URL: "mysql://shared:audit-password@mysql:3306/machinery_crm",
    })).toThrow(/must use different database users/);
    expect(loadMcpConfig({
      ...twoToolEnvironment,
      MCP_QUERY_DATABASE_URL: "mysql://query:query-password@mysql:3306/machinery_crm",
      MCP_AUDIT_DATABASE_URL: "mysql://audit:audit-password@mysql:3306/machinery_crm",
    })).toMatchObject({
      allowedBusinessToolNames: ["crm_customers_list", "erp_inventory_list"],
      allowedBusinessToolRoles: ["SUPER_ADMIN"],
      queryDatabaseUrl: "mysql://query:query-password@mysql:3306/machinery_crm",
      auditDatabaseUrl: "mysql://audit:audit-password@mysql:3306/machinery_crm",
    });
  });

  it("refuses even an empty userId field on a FULL_READ_ONLY service key", () => {
    expect(() => loadMcpConfig({
      NODE_ENV: "test",
      MCP_API_KEYS_JSON: JSON.stringify([{ name: "forbidden", userId: "", keyHash: "d".repeat(64) }]),
      MCP_AUDIT_USER_ID: "audit-user-1",
      MCP_ALLOWED_HOSTS: "localhost:3000",
      MCP_TOOL_MODE: "FULL_READ_ONLY",
    })).toThrow(/must not contain business identity field userId/);
  });

  it("refuses business roles embedded in a service-key entry", () => {
    expect(() => loadMcpConfig({
      MCP_API_KEYS_JSON: JSON.stringify([{ name: "forbidden", role: "SUPER_ADMIN", keyHash: "f".repeat(64) }]),
      MCP_AUDIT_USER_ID: "audit-user-1",
      MCP_ALLOWED_HOSTS: "localhost:3000",
    })).toThrow(/must not contain business identity field role/);
  });

  it("validates the application query timeout", () => {
    expect(() => loadMcpConfig({
      MCP_API_KEYS_JSON: JSON.stringify([{ name: "fastgpt", keyHash: "e".repeat(64) }]),
      MCP_AUDIT_USER_ID: "audit-user-1",
      MCP_ALLOWED_HOSTS: "localhost:3000",
      MCP_QUERY_TIMEOUT_MS: "0",
    })).toThrow(/MCP_QUERY_TIMEOUT_MS/);
  });

  it("refuses legacy user-bound keys in production even when the flag is set", () => {
    expect(() => loadMcpConfig({
      NODE_ENV: "production",
      MCP_API_KEYS_JSON: JSON.stringify([
        { name: "forbidden", userId: "admin-user", keyHash: "c".repeat(64) },
      ]),
      MCP_AUDIT_USER_ID: "audit-user-1",
      MCP_ALLOWED_HOSTS: "mcp.dachuan.pro",
      MCP_LEGACY_USER_BOUND_AUTH: "true",
    })).toThrow(/forbidden in production/);
  });

  it("loads an isolated Lead command mode with separate credentials, database and principal allowlist", () => {
    const config = loadMcpConfig({
      NODE_ENV: "production",
      MCP_TOOL_MODE: "LEAD_WRITE_INTERNAL",
      MCP_API_KEYS_JSON: JSON.stringify([{ name: "readonly-fastgpt", keyHash: "8".repeat(64) }]),
      MCP_COMMAND_API_KEYS_JSON: JSON.stringify([{ name: "lead-ingestor", keyHash: "9".repeat(64) }]),
      MCP_COMMAND_TOOL_ALLOWLIST: "lead_upsert",
      MCP_COMMAND_PRINCIPAL_ALLOWLIST: "ai-lead-ingestor",
      MCP_COMMAND_DATABASE_URL: "mysql://dachuan_lead_writer:writer-password@mysql:3306/machinery_crm",
      MCP_AUDIT_DATABASE_URL: "mysql://dachuan_mcp_audit:audit-password@mysql:3306/machinery_crm",
      MCP_AUDIT_USER_ID: "audit-user-1",
      MCP_ALLOWED_HOSTS: "mcp-write.internal",
    });

    expect(config).toMatchObject({
      toolMode: "lead-write-internal",
      apiKeys: [{ name: "lead-ingestor", keyHash: "9".repeat(64) }],
      allowedCommandToolNames: ["lead_upsert"],
      allowedServicePrincipalIds: ["ai-lead-ingestor"],
      commandDatabaseUrl: "mysql://dachuan_lead_writer:writer-password@mysql:3306/machinery_crm",
      auditDatabaseUrl: "mysql://dachuan_mcp_audit:audit-password@mysql:3306/machinery_crm",
    });
  });

  it("requires proof that the Lead command API credential differs from every read credential", () => {
    const environment = {
      NODE_ENV: "production",
      MCP_TOOL_MODE: "LEAD_WRITE_INTERNAL",
      MCP_COMMAND_API_KEYS_JSON: JSON.stringify([{ name: "lead-ingestor", keyHash: "9".repeat(64) }]),
      MCP_COMMAND_TOOL_ALLOWLIST: "lead_upsert",
      MCP_COMMAND_PRINCIPAL_ALLOWLIST: "ai-lead-ingestor",
      MCP_COMMAND_DATABASE_URL: "mysql://dachuan_lead_writer:writer-password@mysql:3306/machinery_crm",
      MCP_AUDIT_DATABASE_URL: "mysql://dachuan_mcp_audit:audit-password@mysql:3306/machinery_crm",
      MCP_AUDIT_USER_ID: "audit-user-1",
      MCP_ALLOWED_HOSTS: "mcp-write.internal",
    };

    expect(() => loadMcpConfig(environment)).toThrow(/MCP_API_KEYS_JSON is required for credential separation/);
    expect(() => loadMcpConfig({
      ...environment,
      MCP_API_KEYS_JSON: JSON.stringify([{ name: "readonly-fastgpt", keyHash: "9".repeat(64) }]),
    })).toThrow(/must not reuse an MCP_API_KEYS_JSON credential/);
  });
});
