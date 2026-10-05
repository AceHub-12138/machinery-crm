import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_BUSINESS_TOOLS = ["crm_customers_list", "erp_inventory_list"];

function fail(reason) {
  console.error(`MCP_CANARY_RUNTIME_CONFIG=FAIL reason=${reason}`);
  process.exitCode = 1;
}

function parseEnvFile(content) {
  const settings = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trimStart() : line;
    const separator = normalized.indexOf("=");
    if (separator < 1) throw new Error("INVALID_ENV_LINE");
    const key = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    settings[key] = value;
  }
  return settings;
}

function requireValue(settings, name) {
  const value = String(settings[name] || "").trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function parseCsv(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function requireExactSet(actual, expected, reason) {
  if (
    actual.length !== expected.length
    || new Set(actual).size !== actual.length
    || expected.some((item) => !actual.includes(item))
  ) {
    throw new Error(reason);
  }
}

function requireMysqlUrl(settings, name) {
  const value = requireValue(settings, name);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name}_INVALID_MYSQL_URL`);
  }
  if (
    parsed.protocol !== "mysql:"
    || !parsed.username
    || !parsed.hostname
    || !parsed.pathname
    || parsed.pathname === "/"
  ) {
    throw new Error(`${name}_INVALID_MYSQL_URL`);
  }
  return parsed;
}

function validateApiKeys(value) {
  let entries;
  try {
    entries = JSON.parse(value);
  } catch {
    throw new Error("MCP_API_KEYS_JSON_INVALID");
  }
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("MCP_API_KEYS_JSON_INVALID");
  for (const entry of entries) {
    const keyHash = String(entry?.keyHash || "").toLowerCase().replace(/^sha256:/u, "");
    if (!entry?.name || !/^[a-f0-9]{64}$/u.test(keyHash)) throw new Error("MCP_API_KEYS_JSON_INVALID");
  }
}

function validate(settings) {
  if (requireValue(settings, "MCP_TOOL_MODE").toUpperCase() !== "FULL_READ_ONLY") {
    throw new Error("MCP_TOOL_MODE_MUST_BE_FULL_READ_ONLY");
  }
  requireExactSet(
    parseCsv(requireValue(settings, "MCP_TOOL_ALLOWLIST")),
    REQUIRED_BUSINESS_TOOLS,
    "MCP_TOOL_ALLOWLIST_MUST_BE_CANARY_TWO_TOOLS",
  );
  requireExactSet(
    parseCsv(requireValue(settings, "MCP_ALLOWED_CALLER_ROLES")),
    ["SUPER_ADMIN"],
    "MCP_ALLOWED_CALLER_ROLES_MUST_BE_SUPER_ADMIN",
  );
  requireValue(settings, "MCP_ALLOWED_HOSTS");
  requireValue(settings, "MCP_AUDIT_USER_ID");
  validateApiKeys(requireValue(settings, "MCP_API_KEYS_JSON"));

  const queryUrl = requireMysqlUrl(settings, "MCP_QUERY_DATABASE_URL");
  const auditUrl = requireMysqlUrl(settings, "MCP_AUDIT_DATABASE_URL");
  if (queryUrl.username === auditUrl.username) throw new Error("MCP_DATABASE_USERS_MUST_DIFFER");

  const queryTarget = `${queryUrl.hostname.toLowerCase()}:${queryUrl.port || "3306"}${queryUrl.pathname}`;
  const auditTarget = `${auditUrl.hostname.toLowerCase()}:${auditUrl.port || "3306"}${auditUrl.pathname}`;
  if (queryTarget !== auditTarget) throw new Error("MCP_DATABASE_TARGETS_MUST_MATCH");
}

const envPath = process.argv[2];
if (!envPath) {
  fail("ENV_FILE_PATH_REQUIRED");
} else {
  try {
    const settings = parseEnvFile(readFileSync(resolve(envPath), "utf8"));
    validate(settings);
    console.log("MCP_CANARY_RUNTIME_CONFIG=PASS mode=FULL_READ_ONLY tools=2 roles=1 databaseUsersSeparated=true");
  } catch (error) {
    fail(error instanceof Error ? error.message : "UNKNOWN_VALIDATION_ERROR");
  }
}
