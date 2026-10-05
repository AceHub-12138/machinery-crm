import { createHash } from "node:crypto";
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildLeadE2eWorkflow, updateLeadE2eEnv } from "./lead-e2e-workflow.mjs";

const [envArg, baseUrlArg = "http://127.0.0.1:18081"] = process.argv.slice(2);
if (!envArg) throw new Error("Usage: node provision-lead-e2e.mjs <env-file> [base-url]");
const envPath = resolve(envArg);
const baseUrl = new URL(baseUrlArg);
if (baseUrl.protocol !== "http:" || baseUrl.hostname !== "127.0.0.1" || baseUrl.port !== "18081") {
  throw new Error("Lead E2E provisioning is restricted to http://127.0.0.1:18081");
}

const content = readFileSync(envPath, "utf8");
const settings = Object.fromEntries(content.split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1)];
}));
if (settings.IDENTITY_ACCEPTANCE_ENV !== "isolated") throw new Error("Refusing Lead provisioning outside the isolated acceptance environment");
if (!settings.FASTGPT_ROOT_PASSWORD || !settings.MCP_LEAD_SERVICE_KEY) throw new Error("Lead E2E provisioning credentials are missing");
if (!settings.LEAD_E2E_MOCK_URL) throw new Error("LEAD_E2E_MOCK_URL is missing");
if (settings.LEAD_SERVICE_ASSERTION_ENABLED === "true" && !settings.LEAD_E2E_FASTGPT_API_KEY?.startsWith("REPLACE_")) {
  console.log("LEAD_E2E_FASTGPT_CONFIGURATION=ALREADY_CONFIGURED");
  process.exit(0);
}

async function request(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: { accept: "application/json", "content-type": "application/json", ...(init.headers || {}) },
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error(`${path} returned non-JSON status ${response.status}`); }
  if (!response.ok || (typeof payload?.code === "number" && payload.code >= 400)) {
    throw new Error(`${path} failed with status ${response.status} code ${payload?.code ?? "unknown"}`);
  }
  return payload?.data ?? payload;
}

const preLogin = await request("/api/support/user/account/preLogin?username=root");
if (!preLogin?.code) throw new Error("FastGPT pre-login code is missing");
const password = createHash("sha256").update(settings.FASTGPT_ROOT_PASSWORD).digest("hex");
const login = await request("/api/support/user/account/loginByPassword", {
  method: "POST",
  body: JSON.stringify({ username: "root", password, code: preLogin.code, language: "zh-CN" }),
});
if (!login?.token) throw new Error("FastGPT root login token is missing");
await request("/api/support/user/team/plan/getTeamPlanStatus", { headers: { token: login.token } });

const mcpUrl = "http://lead-mcp:3012/api/mcp";
const headerSecret = { Authorization: { value: `Bearer ${settings.MCP_LEAD_SERVICE_KEY}` } };
const tools = await request("/api/core/app/mcpTools/getTools", {
  method: "POST",
  headers: { token: login.token },
  body: JSON.stringify({ url: mcpUrl, headerSecret }),
});
if (!Array.isArray(tools) || tools.length !== 1 || tools[0]?.name !== "lead_upsert") {
  throw new Error(`Lead MCP discovery must return only lead_upsert; received ${Array.isArray(tools) ? tools.length : "invalid"}`);
}
const toolSetId = await request("/api/core/app/mcpTools/create", {
  method: "POST",
  headers: { token: login.token },
  body: JSON.stringify({ name: "Dachuan Lead Write E2E MCP", url: mcpUrl, headerSecret, toolList: tools }),
});
if (!/^[a-f\d]{24}$/i.test(toolSetId)) throw new Error("FastGPT Lead MCP tool set ID is invalid");

const workflow = buildLeadE2eWorkflow({ toolSetId, mockUrl: settings.LEAD_E2E_MOCK_URL });
const appId = await request("/api/core/app/create", {
  method: "POST",
  headers: { token: login.token },
  body: JSON.stringify({ name: "Dachuan Lead Agent E2E", type: "advanced", ...workflow }),
});
if (!/^[a-f\d]{24}$/i.test(appId)) throw new Error("FastGPT Lead Agent ID is invalid");
const apiKey = await request("/api/support/openapi/create", {
  method: "POST",
  headers: { token: login.token },
  body: JSON.stringify({ name: `lead-e2e-${process.env.GITHUB_RUN_ID || "isolated"}`, authProxy: true, limit: { maxUsagePoints: -1 } }),
});
if (typeof apiKey !== "string" || !apiKey.startsWith("fastgpt-") || apiKey.length < 32) throw new Error("FastGPT Lead API key response is invalid");
const appBoundApiKey = `${apiKey}-${appId}`;
const updated = updateLeadE2eEnv(content, { appId, apiKey: appBoundApiKey });
const temporary = `${envPath}.tmp`;
writeFileSync(temporary, updated, { encoding: "utf8", mode: 0o600 });
chmodSync(temporary, 0o600);
renameSync(temporary, envPath);
console.log("LEAD_E2E_FASTGPT_CONFIGURATION=PROVISIONED tools=1 appAllowlist=1");
