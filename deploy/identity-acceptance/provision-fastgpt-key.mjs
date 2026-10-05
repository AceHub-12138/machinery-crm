import { createHash } from "node:crypto";
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [envArg, baseUrlArg = "http://127.0.0.1:18081"] = process.argv.slice(2);
if (!envArg) throw new Error("Usage: node provision-fastgpt-key.mjs <env-file> [base-url]");

const envPath = resolve(envArg);
const baseUrl = new URL(baseUrlArg);
if (baseUrl.protocol !== "http:" || baseUrl.hostname !== "127.0.0.1" || baseUrl.port !== "18081") {
  throw new Error("FastGPT key provisioning is restricted to http://127.0.0.1:18081");
}

const content = readFileSync(envPath, "utf8");
const settings = Object.fromEntries(
  content
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

if (settings.IDENTITY_ACCEPTANCE_ENV !== "isolated") {
  throw new Error("Refusing FastGPT provisioning outside the isolated acceptance environment");
}
if (!settings.FASTGPT_ROOT_PASSWORD) throw new Error("FASTGPT_ROOT_PASSWORD is missing");
if (!settings.AGENT_GATEWAY_FASTGPT_API_KEY?.startsWith("REPLACE_")) {
  console.log("IDENTITY_ACCEPTANCE_FASTGPT_KEY=ALREADY_CONFIGURED");
  process.exit(0);
}

async function request(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned non-JSON status ${response.status}`);
  }
  if (!response.ok || (typeof payload?.code === "number" && payload.code >= 400)) {
    const remoteDetail = String(payload?.error || payload?.message || payload?.statusText || "")
      .replace(/fastgpt-[A-Za-z0-9_-]{16,}/g, "[REDACTED_FASTGPT_KEY]")
      .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[REDACTED_JWT]")
      .replace(/[A-Za-z0-9_+/=-]{48,}/g, "[REDACTED_TOKEN]")
      .replace(/\s+/g, " ")
      .slice(0, 300);
    throw new Error(`${path} failed with status ${response.status} code ${payload?.code ?? "unknown"}${remoteDetail ? ` detail ${remoteDetail}` : ""}`);
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

// A brand-new FastGPT team has no subscription row until the official plan
// status endpoint is visited. Agent creation reads that row for its app quota,
// while MCP tool-set creation does not. Initialize it through FastGPT's public
// API instead of writing MongoDB directly.
await request("/api/support/user/team/plan/getTeamPlanStatus", {
  headers: { token: login.token },
});

const mcpUrl = "http://nginx:8080/api/mcp";
const headerSecret = { Authorization: { value: `Bearer ${settings.MCP_SERVICE_KEY}` } };
const tools = await request("/api/core/app/mcpTools/getTools", {
  method: "POST",
  headers: { token: login.token },
  body: JSON.stringify({ url: mcpUrl, headerSecret }),
});
const allowlistedBusinessTools = new Set(
  String(settings.MCP_TOOL_ALLOWLIST || "")
    .split(",")
    .map((toolName) => toolName.trim())
    .filter(Boolean),
);
const expectedToolCount = settings.MCP_TOOL_MODE === "FULL_READ_ONLY" ? allowlistedBusinessTools.size + 1 : 1;
if (!Array.isArray(tools) || tools.length !== expectedToolCount) {
  throw new Error(`FastGPT MCP discovery returned ${Array.isArray(tools) ? tools.length : "invalid"} tools; expected ${expectedToolCount}`);
}
const identityTool = tools.find((tool) => tool?.name === "dachuan_identity_who_am_i");
if (!identityTool) throw new Error("FastGPT MCP discovery did not return dachuan_identity_who_am_i");

const toolSetId = await request("/api/core/app/mcpTools/create", {
  method: "POST",
  headers: { token: login.token },
  body: JSON.stringify({
    name: `Dachuan ${settings.MCP_TOOL_MODE} Acceptance MCP`,
    url: mcpUrl,
    headerSecret,
    toolList: tools,
  }),
});
if (!/^[a-f\d]{24}$/i.test(toolSetId)) throw new Error("FastGPT MCP tool set ID is invalid");

const agentId = await request("/api/core/app/create", {
  method: "POST",
  headers: { token: login.token },
  body: JSON.stringify({
    name: `Dachuan ${settings.MCP_TOOL_MODE} Acceptance Agent`,
    type: "advanced",
    modules: [
      {
        flowNodeType: "workflowStart",
        name: "Start",
        version: "481",
        nodeId: "identityStart",
        inputs: [{
          key: "userChatInput",
          label: "User question",
          valueType: "string",
          required: true,
          renderTypeList: ["reference", "textarea"],
          toolDescription: "User question",
        }],
        outputs: [{
          id: "userChatInput",
          key: "userChatInput",
          type: "static",
          valueType: "string",
          label: "User question",
        }],
        position: { x: 100, y: 100 },
      },
      {
        flowNodeType: "tool",
        name: `Dachuan Identity MCP/${identityTool.name}`,
        intro: identityTool.description || "Trusted ERP identity summary",
        version: "",
        nodeId: "identityWhoAmI",
        inputs: [],
        outputs: [{
          id: "system_rawResponse",
          key: "system_rawResponse",
          type: "static",
          valueType: "any",
          label: "Raw response",
          description: "MCP tool raw response",
          required: true,
        }],
        toolConfig: { mcpTool: { toolId: `mcp-${toolSetId}/${identityTool.name}` } },
        position: { x: 500, y: 100 },
      },
      {
        flowNodeType: "answerNode",
        name: "Return identity result",
        version: "481",
        nodeId: "identityAnswer",
        inputs: [{
          key: "text",
          label: "Response",
          valueType: "any",
          required: true,
          renderTypeList: ["textarea", "reference"],
          value: ["identityWhoAmI", "system_rawResponse"],
        }],
        outputs: [],
        position: { x: 900, y: 100 },
      },
    ],
    edges: [
      {
        source: "identityStart",
        sourceHandle: "identityStart-source-right",
        target: "identityWhoAmI",
        targetHandle: "identityWhoAmI-target-left",
      },
      {
        source: "identityWhoAmI",
        sourceHandle: "identityWhoAmI-source-right",
        target: "identityAnswer",
        targetHandle: "identityAnswer-target-left",
      },
    ],
    chatConfig: { variables: [] },
  }),
});
if (!/^[a-f\d]{24}$/i.test(agentId)) throw new Error("FastGPT acceptance Agent ID is invalid");

const apiKey = await request("/api/support/openapi/create", {
  method: "POST",
  headers: { token: login.token },
  body: JSON.stringify({
    name: `linux-full-readonly-${process.env.GITHUB_RUN_ID || "isolated"}`,
    authProxy: true,
    limit: { maxUsagePoints: -1 },
  }),
});
if (typeof apiKey !== "string" || !apiKey.startsWith("fastgpt-") || apiKey.length < 32) {
  throw new Error("FastGPT API key response is invalid");
}

const appBoundApiKey = `${apiKey}-${agentId}`;
const updated = content.replace(
  /^AGENT_GATEWAY_FASTGPT_API_KEY=REPLACE_.*$/m,
  `AGENT_GATEWAY_FASTGPT_API_KEY=${appBoundApiKey}`,
);
if (updated === content) throw new Error("Unable to replace the isolated FastGPT API key placeholder");
const temporary = `${envPath}.tmp`;
writeFileSync(temporary, updated, { encoding: "utf8", mode: 0o600 });
chmodSync(temporary, 0o600);
renameSync(temporary, envPath);
console.log(`IDENTITY_ACCEPTANCE_FASTGPT_CONFIGURATION=PROVISIONED tools=${tools.length}`);
