import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const input = process.argv[2];
if (!input) throw new Error("Usage: node validate-env.mjs <env-file>");
const settings = Object.fromEntries(
  readFileSync(resolve(input), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      if (separator < 1) throw new Error("Invalid acceptance environment line");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);
const leadPublicKeys = JSON.parse(settings.LEAD_WRITER_AUTH_KEYS_JSON || "null");
const humanPublicKeys = JSON.parse(settings.AGENT_AUTH_PUBLIC_KEYS_JSON || "null");
const leadPrivateJwk = JSON.parse(readFileSync(join(dirname(resolve(input)), ".lead-service-private-jwk"), "utf8"));
const databaseUrl = new URL(settings.DATABASE_URL || "");
const queryDatabaseUrl = new URL(settings.MCP_QUERY_DATABASE_URL || "");
const auditDatabaseUrl = new URL(settings.MCP_AUDIT_DATABASE_URL || "");
const commandDatabaseUrl = new URL(settings.MCP_COMMAND_DATABASE_URL || "");
const expectedDatabase = "dachuan_identity_acceptance";
const allowedToolModes = new Set(["IDENTITY_POC", "FULL_READ_ONLY"]);
if (
  settings.IDENTITY_ACCEPTANCE_ENV !== "isolated"
  || settings.COMPOSE_PROJECT_NAME !== "dachuan-identity-acceptance"
  || !allowedToolModes.has(settings.MCP_TOOL_MODE)
  || databaseUrl.hostname !== "mysql"
  || databaseUrl.port !== "3306"
  || databaseUrl.pathname !== `/${expectedDatabase}`
  || queryDatabaseUrl.hostname !== "mysql"
  || queryDatabaseUrl.protocol !== "mysql:"
  || !queryDatabaseUrl.username
  || queryDatabaseUrl.port !== "3306"
  || queryDatabaseUrl.pathname !== `/${expectedDatabase}`
  || auditDatabaseUrl.hostname !== "mysql"
  || auditDatabaseUrl.protocol !== "mysql:"
  || !auditDatabaseUrl.username
  || auditDatabaseUrl.port !== "3306"
  || auditDatabaseUrl.pathname !== `/${expectedDatabase}`
  || commandDatabaseUrl.hostname !== "mysql"
  || commandDatabaseUrl.protocol !== "mysql:"
  || !commandDatabaseUrl.username
  || commandDatabaseUrl.port !== "3306"
  || commandDatabaseUrl.pathname !== `/${expectedDatabase}`
  || new Set([queryDatabaseUrl.username, auditDatabaseUrl.username, commandDatabaseUrl.username]).size !== 3
  || settings.MYSQL_DATABASE !== expectedDatabase
  || settings.FASTGPT_IMAGE !== "dachuan-fastgpt:v4.15.1-identity-acceptance.1"
  || settings.CRM_IMAGE !== "dachuanpro-crm-erp-mcp:1.2.0-identity-acceptance.1"
  || !settings.CRM_AGENT_ASSERTION_SECRET
  || /^(GENERATE_|REPLACE_)/.test(settings.CRM_AGENT_ASSERTION_SECRET)
  || settings.CRM_AGENT_ASSERTION_SECRET !== settings.AUTH_SECRET
  || settings.FASTGPT_AIPROXY_API_ENDPOINT !== "http://fastgpt-aiproxy:3000"
  || !settings.MCP_LEAD_SERVICE_KEY
  || /^(GENERATE_|REPLACE_)/.test(settings.MCP_LEAD_SERVICE_KEY)
  || !/^[a-f0-9]{64}$/.test(settings.MCP_LEAD_SERVICE_KEY_HASH || "")
  || settings.LEAD_SERVICE_ASSERTION_ISSUER !== settings.LEAD_WRITER_AUTH_ISSUER
  || settings.LEAD_SERVICE_ASSERTION_AUDIENCE !== settings.LEAD_WRITER_AUTH_AUDIENCE
  || settings.LEAD_SERVICE_ASSERTION_AUDIENCE === settings.AGENT_AUTH_AUDIENCE
  || settings.LEAD_SERVICE_ASSERTION_REDIS_PREFIX !== settings.LEAD_WRITER_AUTH_REDIS_PREFIX
  || settings.LEAD_SERVICE_ASSERTION_REDIS_PREFIX === settings.AGENT_AUTH_REDIS_PREFIX
  || settings.LEAD_SERVICE_ASSERTION_TOKEN_TTL_SECONDS !== settings.LEAD_WRITER_AUTH_TOKEN_TTL_SECONDS
  || Number(settings.LEAD_SERVICE_ASSERTION_TOKEN_TTL_SECONDS) < 300
  || Number(settings.LEAD_SERVICE_ASSERTION_TOKEN_TTL_SECONDS) > 900
  || settings.LEAD_E2E_MOCK_URL !== "http://lead-llm-mock:4010/v1/chat/completions"
  || !Array.isArray(leadPublicKeys)
  || leadPublicKeys.length !== 1
  || Object.prototype.hasOwnProperty.call(leadPublicKeys[0]?.publicJwk || {}, "d")
  || leadPublicKeys[0]?.publicJwk?.x !== leadPrivateJwk.x
  || typeof leadPrivateJwk.d !== "string"
  || !Array.isArray(humanPublicKeys)
  || humanPublicKeys.length < 1
  || humanPublicKeys.some((entry) => Object.prototype.hasOwnProperty.call(entry?.publicJwk || {}, "d"))
  || humanPublicKeys.some((entry) => entry?.publicJwk?.x === leadPublicKeys[0]?.publicJwk?.x)
  || (settings.LEAD_SERVICE_ASSERTION_ENABLED === "true" && (
    !String(settings.LEAD_SERVICE_ASSERTION_APP_IDS || "").split(",").every((appId) => /^[a-f\d]{24}$/i.test(appId))
    || settings.LEAD_E2E_FASTGPT_API_KEY?.startsWith("REPLACE_")
  ))
  || [
    "FASTGPT_PLUGIN_TOKEN",
    "FASTGPT_SANDBOX_TOKEN",
    "FASTGPT_AIPROXY_PG_PASSWORD",
    "FASTGPT_AIPROXY_API_TOKEN",
  ].some((name) => !settings[name] || /^(GENERATE_|REPLACE_)/.test(settings[name]))
) {
  throw new Error("Environment does not target the fixed identity-acceptance isolation project");
}
console.log("IDENTITY_ACCEPTANCE_ENVIRONMENT=VERIFIED");
