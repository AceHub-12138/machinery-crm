import type { McpApplicationConfig } from "@/lib/mcp/application";
import { MCP_TOOL_NAMES } from "@/lib/mcp/tools";
import { MCP_COMMAND_TOOL_NAMES } from "@/lib/mcp/command-tools";

type McpEnvironment = Record<string, string | undefined>;

function splitCsv(value: string | undefined) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseApiKeys(value: string | undefined, forbidUserIdField = false, variableName = "MCP_API_KEYS_JSON") {
  if (!value) throw new Error(`${variableName} is required`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${variableName} must be valid JSON`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`${variableName} must contain at least one API key`);
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`MCP API key entry ${index + 1} is invalid`);
    }
    const input = entry as Record<string, unknown>;
    if (forbidUserIdField && "userId" in input) {
      throw new Error(`MCP API key entry ${index + 1} must not contain business identity field userId`);
    }
    for (const forbidden of ["role", "region", "territories", "viewScope"] as const) {
      if (forbidden in input) {
        throw new Error(`MCP API key entry ${index + 1} must not contain business identity field ${forbidden}`);
      }
    }
    const name = String(input.name || "").trim();
    const userId = String(input.userId || "").trim();
    const keyHash = String(input.keyHash || "").trim().toLowerCase().replace(/^sha256:/, "");
    if (!name || !/^[a-f0-9]{64}$/.test(keyHash)) {
      throw new Error(`MCP API key entry ${index + 1} requires name and a SHA-256 keyHash`);
    }
    return { name, ...(userId ? { userId } : {}), keyHash };
  });
}

function parseQueryTimeout(value: string | undefined) {
  const parsed = Number(value || "5000");
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 30_000) {
    throw new Error("MCP_QUERY_TIMEOUT_MS must be an integer between 100 and 30000");
  }
  return parsed;
}

function parseBusinessToolAllowlist(value: string | undefined) {
  const allowlist = splitCsv(value);
  if (allowlist.length === 0) {
    throw new Error("MCP_TOOL_ALLOWLIST is required in FULL_READ_ONLY mode");
  }
  if (new Set(allowlist).size !== allowlist.length) {
    throw new Error("MCP_TOOL_ALLOWLIST must not contain duplicate tool names");
  }
  const unknown = allowlist.filter((toolName) => !MCP_TOOL_NAMES.includes(toolName as typeof MCP_TOOL_NAMES[number]));
  if (unknown.length > 0) {
    throw new Error(`MCP_TOOL_ALLOWLIST contains unknown tool names: ${unknown.join(", ")}`);
  }
  return allowlist;
}

function parseCommandToolAllowlist(value: string | undefined) {
  const allowlist = splitCsv(value);
  if (allowlist.length === 0) throw new Error("MCP_COMMAND_TOOL_ALLOWLIST is required in LEAD_WRITE_INTERNAL mode");
  if (new Set(allowlist).size !== allowlist.length) throw new Error("MCP_COMMAND_TOOL_ALLOWLIST must not contain duplicate tool names");
  const unknown = allowlist.filter((toolName) => !MCP_COMMAND_TOOL_NAMES.includes(toolName as typeof MCP_COMMAND_TOOL_NAMES[number]));
  if (unknown.length > 0) throw new Error(`MCP_COMMAND_TOOL_ALLOWLIST contains unknown tool names: ${unknown.join(", ")}`);
  if (allowlist.length !== 1 || allowlist[0] !== "lead_upsert") {
    throw new Error("LEAD_WRITE_INTERNAL allows only lead_upsert");
  }
  return allowlist;
}

function parseServicePrincipalAllowlist(value: string | undefined) {
  const allowlist = splitCsv(value);
  if (
    allowlist.length === 0
    || new Set(allowlist).size !== allowlist.length
    || allowlist.some((principalId) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(principalId))
  ) {
    throw new Error("MCP_COMMAND_PRINCIPAL_ALLOWLIST must contain unique stable service principal IDs");
  }
  return allowlist;
}

const MCP_ROLES = ["SUPER_ADMIN", "SALES", "FOREIGN_TRADE", "PURCHASE", "WAREHOUSE"] as const;

function parseBusinessToolRoleAllowlist(value: string | undefined) {
  const allowlist = splitCsv(value);
  if (allowlist.length === 0) {
    throw new Error("MCP_ALLOWED_CALLER_ROLES is required in FULL_READ_ONLY mode");
  }
  if (new Set(allowlist).size !== allowlist.length || allowlist.some((role) => !MCP_ROLES.includes(role as typeof MCP_ROLES[number]))) {
    throw new Error("MCP_ALLOWED_CALLER_ROLES must contain unique known ERP roles");
  }
  return allowlist as McpApplicationConfig["allowedBusinessToolRoles"];
}

function requiredDatabaseUrl(value: string | undefined, name: string) {
  const databaseUrl = String(value || "").trim();
  if (!databaseUrl) throw new Error(`${name} is required for the configured MCP mode`);
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== "mysql:" || !parsed.username || !parsed.hostname || !parsed.pathname || parsed.pathname === "/") {
      throw new Error("invalid");
    }
  } catch {
    throw new Error(`${name} must be a valid MySQL URL`);
  }
  return databaseUrl;
}

export function loadMcpConfig(environment: McpEnvironment = process.env): McpApplicationConfig {
  const allowedHosts = splitCsv(environment.MCP_ALLOWED_HOSTS);
  if (allowedHosts.length === 0) throw new Error("MCP_ALLOWED_HOSTS is required");
  const rejectedAuditUserId = String(environment.MCP_AUDIT_USER_ID || "").trim();
  if (!rejectedAuditUserId) throw new Error("MCP_AUDIT_USER_ID is required");

  const legacyUserBindingEnabled = environment.MCP_LEGACY_USER_BOUND_AUTH?.trim().toLowerCase() === "true";
  if (legacyUserBindingEnabled && environment.NODE_ENV?.trim().toLowerCase() === "production") {
    throw new Error("Legacy MCP user-bound auth is forbidden in production");
  }
  const toolMode = environment.MCP_TOOL_MODE?.trim().toUpperCase() || "IDENTITY_POC";
  if (!["IDENTITY_POC", "FULL_READ_ONLY", "LEAD_WRITE_INTERNAL"].includes(toolMode)) {
    throw new Error("MCP_TOOL_MODE must be IDENTITY_POC, FULL_READ_ONLY or LEAD_WRITE_INTERNAL");
  }
  const commandMode = toolMode === "LEAD_WRITE_INTERNAL";
  const apiKeys = parseApiKeys(
    commandMode ? environment.MCP_COMMAND_API_KEYS_JSON : environment.MCP_API_KEYS_JSON,
    toolMode === "FULL_READ_ONLY" || commandMode,
    commandMode ? "MCP_COMMAND_API_KEYS_JSON" : "MCP_API_KEYS_JSON",
  );
  if (commandMode && !String(environment.MCP_API_KEYS_JSON || "").trim()) {
    throw new Error("MCP_API_KEYS_JSON is required for credential separation in LEAD_WRITE_INTERNAL mode");
  }
  const readApiKeys = commandMode
    ? parseApiKeys(environment.MCP_API_KEYS_JSON, false, "MCP_API_KEYS_JSON")
    : [];
  const readApiKeyHashes = new Set(readApiKeys.map((entry) => entry.keyHash));
  if (commandMode && apiKeys.some((entry) => readApiKeyHashes.has(entry.keyHash))) {
    throw new Error("MCP_COMMAND_API_KEYS_JSON must not reuse an MCP_API_KEYS_JSON credential");
  }
  const allowedBusinessToolNames = toolMode === "FULL_READ_ONLY"
    ? parseBusinessToolAllowlist(environment.MCP_TOOL_ALLOWLIST)
    : undefined;
  const allowedBusinessToolRoles = toolMode === "FULL_READ_ONLY"
    ? parseBusinessToolRoleAllowlist(environment.MCP_ALLOWED_CALLER_ROLES)
    : undefined;
  const allowedCommandToolNames = commandMode
    ? parseCommandToolAllowlist(environment.MCP_COMMAND_TOOL_ALLOWLIST)
    : undefined;
  const allowedServicePrincipalIds = commandMode
    ? parseServicePrincipalAllowlist(environment.MCP_COMMAND_PRINCIPAL_ALLOWLIST)
    : undefined;
  const queryDatabaseUrl = toolMode === "FULL_READ_ONLY"
    ? requiredDatabaseUrl(environment.MCP_QUERY_DATABASE_URL, "MCP_QUERY_DATABASE_URL")
    : undefined;
  const auditDatabaseUrl = toolMode === "FULL_READ_ONLY" || commandMode
    ? requiredDatabaseUrl(environment.MCP_AUDIT_DATABASE_URL, "MCP_AUDIT_DATABASE_URL")
    : undefined;
  const commandDatabaseUrl = commandMode
    ? requiredDatabaseUrl(environment.MCP_COMMAND_DATABASE_URL, "MCP_COMMAND_DATABASE_URL")
    : undefined;
  if (
    queryDatabaseUrl
    && auditDatabaseUrl
    && new URL(queryDatabaseUrl).username === new URL(auditDatabaseUrl).username
  ) {
    throw new Error("MCP_QUERY_DATABASE_URL and MCP_AUDIT_DATABASE_URL must use different database users");
  }
  if (
    commandDatabaseUrl
    && auditDatabaseUrl
    && new URL(commandDatabaseUrl).username === new URL(auditDatabaseUrl).username
  ) {
    throw new Error("MCP_COMMAND_DATABASE_URL and MCP_AUDIT_DATABASE_URL must use different database users");
  }
  if ((toolMode === "FULL_READ_ONLY" || commandMode) && legacyUserBindingEnabled) {
    throw new Error(`${toolMode} forbids API-key-bound user identity`);
  }
  if (legacyUserBindingEnabled && apiKeys.some((entry) => !entry.userId)) {
    throw new Error("Legacy MCP user-bound auth requires userId on every API key entry");
  }

  return {
    apiKeys,
    rejectedAuditUserId,
    queryDatabaseUrl,
    auditDatabaseUrl,
    commandDatabaseUrl,
    allowedHosts,
    allowedOrigins: splitCsv(environment.MCP_ALLOWED_ORIGINS),
    legacyUserBindingEnabled,
    toolMode: toolMode === "FULL_READ_ONLY"
      ? "full-read-only"
      : toolMode === "LEAD_WRITE_INTERNAL" ? "lead-write-internal" : "identity-poc",
    allowedBusinessToolNames,
    allowedBusinessToolRoles,
    allowedCommandToolNames,
    allowedServicePrincipalIds,
    queryTimeoutMs: parseQueryTimeout(environment.MCP_QUERY_TIMEOUT_MS),
    diagnosticLogging: environment.MCP_DIAGNOSTIC_LOGGING === "true",
  };
}
