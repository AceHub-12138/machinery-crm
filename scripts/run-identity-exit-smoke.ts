import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createAgentAuthRuntime, loadAgentAuthConfig } from "@/lib/agent-auth/config";
import {
  acceptanceLoginUsers,
  runAcceptanceLoginPreflight,
} from "./identity-acceptance-crm-login";
import {
  armNaturalExitWatchdog,
  cleanupAcceptanceResources,
  createAcceptanceResourceTracker,
  readTrackedResponseText,
  requestIdSummary,
  safeFailureMessage,
  trackedFetch,
  writeAcceptanceEvidenceAtomic,
  type AcceptanceEvidence,
} from "./identity-acceptance-runner-support";

if (process.env.IDENTITY_ACCEPTANCE_ENV !== "isolated") {
  throw new Error("Refusing to run outside IDENTITY_ACCEPTANCE_ENV=isolated");
}
if (process.env.MCP_TOOL_MODE !== "IDENTITY_POC") {
  throw new Error("Identity exit smoke requires MCP_TOOL_MODE=IDENTITY_POC");
}
const databaseUrl = new URL(process.env.DATABASE_URL || "");
if (databaseUrl.hostname !== "mysql") {
  throw new Error("Exit smoke database must be the isolated mysql service");
}

const required = (name: string) => {
  const value = String(process.env[name] || "").trim();
  if (!value || value.startsWith("REPLACE_") || value.startsWith("GENERATE_")) {
    throw new Error(`${name} is not configured`);
  }
  return value;
};

const startedAt = new Date().toISOString();
const requestId = `accept-exit-smoke-${randomUUID()}`;
const checks: string[] = [];
const prisma = new PrismaClient();
const runtime = await createAgentAuthRuntime(loadAgentAuthConfig());
const tracker = createAcceptanceResourceTracker();
let smokeError: unknown;
let sensitiveScanStatus: AcceptanceEvidence["sensitiveScanStatus"] = "NOT_RUN";

try {
  const salesUser = acceptanceLoginUsers(process.env).find(
    (user) => user.expectedUserId === "identity-acceptance-sales-a",
  );
  if (!salesUser) throw new Error("Isolated sales A acceptance user is not configured");
  const login = await runAcceptanceLoginPreflight({
    crmUrl: required("ACCEPTANCE_CRM_URL").replace(/\/$/, ""),
    password: required("ACCEPTANCE_USER_PASSWORD"),
    users: [salesUser],
  });
  if (login.diagnostics.length !== 1 || !login.sessionsByUserId.has(salesUser.expectedUserId)) {
    throw new Error("Single-user real CRM login preflight failed");
  }
  checks.push("single isolated ERP user completes real CRM login and session verification");

  const issued = await runtime.tokenService.issue(salesUser.expectedUserId);
  const response = await trackedFetch(tracker, required("ACCEPTANCE_MCP_URL"), {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${required("MCP_SERVICE_KEY")}`,
      "content-type": "application/json",
      "x-dachuan-request-id": requestId,
      "x-dachuan-user-assertion": issued.token,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "tools/call",
      params: { name: "dachuan_identity_who_am_i", arguments: {} },
    }),
  });
  const text = await readTrackedResponseText(tracker, response);
  const body = JSON.parse(text) as {
    result?: { structuredContent?: { data?: { userId?: string }; meta?: { requestId?: string } } };
  };
  const result = body.result?.structuredContent;
  if (
    !response.ok
    || result?.data?.userId !== salesUser.expectedUserId
    || result?.meta?.requestId !== requestId
  ) {
    throw new Error("Single who_am_i request did not preserve the isolated ERP identity and requestId");
  }
  checks.push("one who_am_i call preserves trusted ERP userId and requestId");

  const privateKey = String(
    (JSON.parse(required("AGENT_AUTH_KEYS_JSON")) as Array<{ privateJwk?: { d?: string } }>)[0]
      ?.privateJwk?.d || "",
  );
  const forbidden = [required("MCP_SERVICE_KEY"), issued.token, privateKey].filter((value) => value.length >= 8);
  if (forbidden.some((value) => text.includes(value))) {
    throw new Error("Exit smoke response sensitive information scan failed");
  }
  sensitiveScanStatus = "PASS";
  checks.push("minimal response sensitive information scan passes");
} catch (error) {
  smokeError = error;
  throw error;
} finally {
  const evidence: AcceptanceEvidence = {
    overallStatus: smokeError ? "FAIL" : "PASS",
    checks,
    imageIds: {
      fastGpt: String(process.env.ACCEPTANCE_FASTGPT_IMAGE_ID || "unknown"),
      crmMcp: String(process.env.ACCEPTANCE_CRM_IMAGE_ID || "unknown"),
      runner: String(process.env.ACCEPTANCE_RUNNER_IMAGE_ID || "unknown"),
    },
    startedAt,
    completedAt: new Date().toISOString(),
    requestIdSummary: requestIdSummary([requestId]),
    sensitiveScanStatus,
    ...(smokeError ? { failure: safeFailureMessage(smokeError) } : {}),
  };
  writeAcceptanceEvidenceAtomic(evidence);
  if (!smokeError) console.log(`IDENTITY_EXIT_SMOKE_RESULT=PASS (${checks.length} checks)`);
  armNaturalExitWatchdog();
  await cleanupAcceptanceResources({ prisma, stateStore: runtime.stateStore, tracker });
}
