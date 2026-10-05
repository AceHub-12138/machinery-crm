import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./validate-mcp-canary-runtime-env.mjs", import.meta.url));
const temporaryDirectories = [];

function makeEnv(overrides = {}) {
  return {
    MCP_ALLOWED_CALLER_ROLES: "SUPER_ADMIN",
    MCP_ALLOWED_HOSTS: "172.23.0.10:3010",
    MCP_API_KEYS_JSON: JSON.stringify([{ name: "canary", keyHash: "a".repeat(64) }]),
    MCP_AUDIT_DATABASE_URL: "mysql://audit:audit-password@crm-db:3306/machinery_crm",
    MCP_AUDIT_USER_ID: "audit-user",
    MCP_QUERY_DATABASE_URL: "mysql://reader:reader-password@crm-db:3306/machinery_crm",
    MCP_TOOL_ALLOWLIST: "crm_customers_list,erp_inventory_list",
    MCP_TOOL_MODE: "FULL_READ_ONLY",
    ...overrides,
  };
}

function runValidator(settings) {
  const directory = mkdtempSync(join(tmpdir(), "mcp-canary-env-"));
  temporaryDirectories.push(directory);
  const envFile = join(directory, "runtime.env");
  const contents = Object.entries(settings).map(([key, value]) => `${key}=${value}`).join("\n");
  writeFileSync(envFile, contents, { encoding: "utf8", mode: 0o600 });
  return spawnSync(process.execPath, [script, envFile], { encoding: "utf8" });
}

afterEach(() => {
  while (temporaryDirectories.length > 0) rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

describe("MCP Canary runtime environment preflight", () => {
  it("accepts the isolated two-tool, SUPER_ADMIN-only dual-account contract", () => {
    const result = runValidator(makeEnv());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("MCP_CANARY_RUNTIME_CONFIG=PASS");
    expect(result.stdout).not.toContain("password");
  });

  it("catches the missing audit URL that the API route otherwise reports as a generic 503", () => {
    const settings = makeEnv();
    delete settings.MCP_AUDIT_DATABASE_URL;
    const result = runValidator(settings);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("reason=MCP_AUDIT_DATABASE_URL_REQUIRED");
    expect(result.stderr).not.toContain("reader-password");
  });

  it("rejects shared query/audit users without exposing either URL", () => {
    const result = runValidator(makeEnv({
      MCP_AUDIT_DATABASE_URL: "mysql://reader:audit-password@crm-db:3306/machinery_crm",
    }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("reason=MCP_DATABASE_USERS_MUST_DIFFER");
    expect(result.stderr).not.toContain("mysql://");
  });

  it("rejects query and audit URLs that point to different database targets", () => {
    const result = runValidator(makeEnv({
      MCP_AUDIT_DATABASE_URL: "mysql://audit:audit-password@other-db:3306/machinery_crm",
    }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("reason=MCP_DATABASE_TARGETS_MUST_MATCH");
  });

  it("keeps the Canary tool and role scope exact", () => {
    const tools = runValidator(makeEnv({ MCP_TOOL_ALLOWLIST: "crm_customers_list" }));
    const roles = runValidator(makeEnv({ MCP_ALLOWED_CALLER_ROLES: "SUPER_ADMIN,WAREHOUSE" }));
    expect(tools.status).toBe(1);
    expect(tools.stderr).toContain("reason=MCP_TOOL_ALLOWLIST_MUST_BE_CANARY_TWO_TOOLS");
    expect(roles.status).toBe(1);
    expect(roles.stderr).toContain("reason=MCP_ALLOWED_CALLER_ROLES_MUST_BE_SUPER_ADMIN");
  });
});
