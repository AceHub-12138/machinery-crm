import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  buildLeadE2eCompletionBody,
  findLeadWriteResult,
  safeLeadE2eFailure,
  safeLeadE2eResponseSummary,
  type LeadWriteResult,
} from "./lead-e2e-acceptance-support";

function required(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value || value.startsWith("REPLACE_")) throw new Error(`${name} is required`);
  return value;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const fastGptUrl = new URL(required("LEAD_E2E_FASTGPT_URL"));
if (fastGptUrl.hostname !== "fastgpt" || fastGptUrl.port !== "3000" || fastGptUrl.pathname !== "/api/v1/chat/completions") {
  throw new Error("LEAD_E2E_FASTGPT_URL must target the isolated FastGPT service");
}
const databaseUrl = new URL(required("LEAD_E2E_DATABASE_URL"));
if (databaseUrl.hostname !== "mysql" || databaseUrl.pathname !== "/dachuan_identity_acceptance") {
  throw new Error("LEAD_E2E_DATABASE_URL must target the isolated acceptance database");
}
const apiKey = required("LEAD_E2E_FASTGPT_API_KEY");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });

type LeadInput = Record<string, unknown> & {
  companyName: string;
  sourceUrl: string;
  searchKeyword: string;
  idempotencyKey: string;
  externalLeadId: string;
};

async function callFastGpt(lead: LeadInput) {
  const response = await fetch(fastGptUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(buildLeadE2eCompletionBody(lead)),
  });
  const text = await response.text();
  let payload: unknown = null;
  try { payload = JSON.parse(text); } catch { /* FastGPT may return a non-JSON workflow error. */ }
  return { status: response.status, payload, result: findLeadWriteResult(payload) };
}

function leadInput(suffix: string, externalLeadId: string): LeadInput {
  return {
    companyName: `Dachuan Lead E2E ${suffix}`,
    source: "BAIDU_SEARCH",
    sourceUrl: "https://example.invalid/lead-e2e",
    searchKeyword: "数控机床采购",
    sourceSystem: "n8n-lead-staging-e2e",
    externalLeadId,
    idempotencyKey: `n8n-lead-e2e-${suffix}-${externalLeadId}`,
    requestId: `trace-${randomUUID()}`,
  };
}

async function assertResult(response: Awaited<ReturnType<typeof callFastGpt>>, expected: Partial<LeadWriteResult>) {
  check(response.status === 200, `FastGPT Lead workflow returned status ${response.status}`);
  check(
    response.result,
    `FastGPT response did not contain the lead_upsert result (${safeLeadE2eResponseSummary(response.payload)})`,
  );
  for (const [key, value] of Object.entries(expected)) {
    check(response.result[key as keyof LeadWriteResult] === value, `Unexpected Lead write result field ${key}`);
  }
  return response.result;
}

async function main() {
  const suffix = randomUUID();
  const firstInput = leadInput(suffix, `${suffix}-source-1`);
  const secondInput = {
    ...leadInput(suffix, `${suffix}-source-2`),
    sourceUrl: "https://example.invalid/lead-e2e-second-hit",
    searchKeyword: "龙门加工中心采购",
  };
  const invalidInput = { ...leadInput(suffix, `${suffix}-source-invalid`), mockMode: "invalid-score" };

  try {
    const created = await assertResult(await callFastGpt(firstInput), { dedupStatus: "UNIQUE", replay: false, writeDisposition: "CREATED", duplicateOfLeadId: null });
    const replay = await assertResult(await callFastGpt(firstInput), { dedupStatus: "UNIQUE", replay: true, writeDisposition: "REPLAY", duplicateOfLeadId: null });
    check(replay.id === created.id, "Idempotent replay did not return the original Lead ID");
    const merged = await assertResult(await callFastGpt(secondInput), { dedupStatus: "UNIQUE", replay: false, writeDisposition: "MERGED", duplicateOfLeadId: null });
    check(merged.id === created.id, "Same-company hit did not merge into the original Lead");

    const beforeInvalid = await prisma.lead.count({ where: { externalLeadId: invalidInput.externalLeadId } });
    const invalid = await callFastGpt(invalidInput);
    check(invalid.status >= 400 || !invalid.result, "Invalid score JSON did not fail closed before lead_upsert");
    const afterInvalid = await prisma.lead.count({ where: { externalLeadId: invalidInput.externalLeadId } });
    check(beforeInvalid === 0 && afterInvalid === 0, "Invalid score JSON produced a database row");

    const lead = await prisma.lead.findUnique({
      where: { id: created.id },
      select: { id: true, sourceUrl: true, searchKeyword: true, dedupStatus: true, duplicateOfLeadId: true, sourceModelVersion: true, extractorVersion: true },
    });
    check(lead?.sourceModelVersion === "deepseek-ci-mock-v1" && lead.extractorVersion === "lead-score-v1", "Model/extractor versions were not persisted");
    check(lead.sourceUrl === firstInput.sourceUrl, "Repeated company hit overwrote the original source URL");
    check(lead.searchKeyword === `${firstInput.searchKeyword}；${secondInput.searchKeyword}`, "Repeated company keywords were not accumulated");
    check(await prisma.lead.count({ where: { companyName: firstInput.companyName, sourceSystem: "n8n-lead-staging-e2e" } }) === 1, "Lead E2E company merge created more than one row");
    check(await prisma.leadWriteIdempotency.count({ where: { leadId: created.id } }) === 2, "Lead E2E idempotency receipts were not persisted");

    const audits = await prisma.leadWriteAudit.findMany({
      where: { idempotencyKey: { in: [firstInput.idempotencyKey, secondInput.idempotencyKey] } },
      select: { idempotencyKey: true, outcome: true, principalType: true, principalId: true },
    });
    const firstOutcomes = audits.filter((audit) => audit.idempotencyKey === firstInput.idempotencyKey).map((audit) => audit.outcome).sort();
    const secondOutcomes = audits.filter((audit) => audit.idempotencyKey === secondInput.idempotencyKey).map((audit) => audit.outcome).sort();
    check(firstOutcomes.join(",") === "CREATED,REPLAY" && secondOutcomes.join(",") === "CREATED", "Lead write audit outcomes mismatch");
    check(audits.every((audit) => audit.principalType === "SERVICE" && audit.principalId === "fastgpt-lead-agent"), "Lead audit principal mismatch");
    console.log("LEAD_E2E_ACCEPTANCE=PASS fastgpt=1 serviceAssertion=1 catalog=1 created=1 merged=1 replay=1 invalidScoreDenied=1 audit=3");
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(`LEAD_E2E_ACCEPTANCE=FAIL error=${safeLeadE2eFailure(error)}`);
  process.exitCode = 1;
});
