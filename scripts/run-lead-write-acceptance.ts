import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { createMcpRequestHandler } from "@/lib/mcp/application";
import { createServiceTokenService, type AgentJtiStore } from "@/lib/agent-auth/token";
import { canonicalLeadPayloadHash, createPrismaLeadCommandDataSource } from "@/lib/mcp/prisma-command-data-source";

function required(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function strictNormalizedCompanyName(companyName: string) {
  return companyName.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function legacyDedupFingerprint(companyName: string, phone?: string, email?: string) {
  const company = companyName.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\s\p{P}\p{S}]+/gu, "");
  const normalizedPhone = phone?.replace(/\D/g, "") ?? "";
  const normalizedEmail = email?.toLocaleLowerCase("en-US") ?? "";
  return createHash("sha256").update(`lead-dedup-v1|${company}|${normalizedPhone}|${normalizedEmail}`).digest("hex");
}

function companyDedupFingerprint(companyName: string) {
  return createHash("sha256").update(`lead-company-v1|${strictNormalizedCompanyName(companyName)}`).digest("hex");
}

type McpJsonPayload = {
  result?: {
    tools?: Array<{ name?: string }>;
    structuredContent?: {
      ok?: boolean;
      data?: { items?: Array<{
        id?: string;
        replay?: boolean;
        writeDisposition?: "CREATED" | "MERGED" | "REPLAY";
        routingOutcome?: "ASSIGNED" | "REGION_UNRESOLVED" | "NO_MATCHING_ASSIGNEE" | "MULTIPLE_MATCHING_ASSIGNEES" | "ROUTING_UNAVAILABLE" | null;
        dedupStatus?: string;
        duplicateOfLeadId?: string | null;
      }> };
      error?: { code?: string };
    };
  };
};

function stateStore(): AgentJtiStore {
  const active = new Set<string>();
  return {
    async register(jti) { active.add(jti); },
    async isActive(jti) { return active.has(jti); },
    async revoke(jti) { active.delete(jti); },
  };
}

async function main() {
const commandDatabaseUrl = required("MCP_COMMAND_DATABASE_URL");
const rootDatabaseUrl = required("LEAD_WRITE_ACCEPTANCE_ROOT_DATABASE_URL");
const commandClient = new PrismaClient({ datasources: { db: { url: commandDatabaseUrl } } });
const rootClient = new PrismaClient({ datasources: { db: { url: rootDatabaseUrl } } });
const commandDataSource = createPrismaLeadCommandDataSource(commandClient);
const serviceSecret = `lead-acceptance-${randomUUID()}`;
const serviceKeyHash = createHash("sha256").update(serviceSecret).digest("hex");
const keys = generateKeyPairSync("ed25519");
const store = stateStore();
const tokenService = createServiceTokenService({
  issuer: "lead-write-acceptance",
  audience: "lead-write-acceptance-command",
  ttlSeconds: 300,
  activeKid: "lead-write-acceptance-1",
  signingKeys: [{ kid: "lead-write-acceptance-1", key: keys.privateKey }],
  verificationKeys: [{ kid: "lead-write-acceptance-1", key: keys.publicKey }],
  stateStore: store,
});
  const issued = await tokenService.issue("ai-lead-ingestor", ["lead:create"]);
  const missingScopeJti = randomUUID();
  await store.register(missingScopeJti, 300);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const missingScopeToken = await new SignJWT({ principalType: "SERVICE" })
    .setProtectedHeader({ alg: "EdDSA", kid: "lead-write-acceptance-1", typ: "JWT" })
    .setIssuer("lead-write-acceptance")
    .setAudience("lead-write-acceptance-command")
    .setSubject("ai-lead-ingestor")
    .setJti(missingScopeJti)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + 300)
    .sign(keys.privateKey);
  const wrongAudienceService = createServiceTokenService({
    issuer: "lead-write-acceptance",
    audience: "wrong-lead-write-audience",
    ttlSeconds: 300,
    activeKid: "lead-write-acceptance-1",
    signingKeys: [{ kid: "lead-write-acceptance-1", key: keys.privateKey }],
    verificationKeys: [{ kid: "lead-write-acceptance-1", key: keys.publicKey }],
    stateStore: store,
  });
  const wrongAudience = await wrongAudienceService.issue("ai-lead-ingestor", ["lead:create"]);
const handler = createMcpRequestHandler({
  config: {
    apiKeys: [{ name: "lead-write-acceptance", keyHash: serviceKeyHash }],
    rejectedAuditUserId: "lead-write-acceptance-audit",
    allowedHosts: ["lead-write-acceptance.internal"],
    allowedOrigins: [],
    toolMode: "lead-write-internal",
    allowedCommandToolNames: ["lead_upsert"],
    allowedServicePrincipalIds: ["ai-lead-ingestor"],
  },
  serviceIdentityVerifier: tokenService,
  dataSource: {
    async execute() { throw new Error("query path must remain disabled"); },
    executeCommand: commandDataSource.executeCommand,
    async writeAudit() {},
  },
});

  function mcpRequest(body: unknown, options?: { humanOnly?: boolean; serviceAssertion?: string }) {
  return new Request("https://lead-write-acceptance.internal/api/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${serviceSecret}`,
      "content-type": "application/json",
      host: "lead-write-acceptance.internal",
      "x-dachuan-request-id": `acceptance-${randomUUID()}`,
      ...(options?.humanOnly
        ? { "x-dachuan-user-assertion": "human-super-admin-assertion" }
        : { "x-dachuan-service-assertion": options?.serviceAssertion || issued.token }),
    },
    body: JSON.stringify(body),
  });
}

async function callLead(item: Record<string, unknown>) {
  const response = await handler(mcpRequest({
    jsonrpc: "2.0",
    id: randomUUID(),
    method: "tools/call",
    params: { name: "lead_upsert", arguments: { items: [item] } },
  }));
  return { response, payload: await response.json() as McpJsonPayload };
}

try {
  const catalogResponse = await handler(mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }));
  const catalog = await catalogResponse.json() as McpJsonPayload;
  check(catalog.result?.tools?.length === 1 && catalog.result.tools[0].name === "lead_upsert", "Lead command catalog isolation failed");

  const suffix = randomUUID();
  const legacyCompanyName = `Legacy Upgrade（${suffix}）有限公司`;
  const legacyIncomingCompanyName = `legacy upgrade ${suffix} 有限公司`;
  const legacyPhone = "13800000001";
  const legacyEmail = `legacy-${suffix}@example.invalid`;
  const legacyLeadId = randomUUID();
  const legacyOldDedupKey = legacyDedupFingerprint(legacyCompanyName, legacyPhone, legacyEmail);
  const legacyNewDedupKey = companyDedupFingerprint(legacyIncomingCompanyName);
  check(legacyOldDedupKey !== legacyNewDedupKey, "Legacy and company-only dedup fingerprints unexpectedly matched");
  await rootClient.lead.create({
    data: {
      id: legacyLeadId,
      companyName: legacyCompanyName,
      phone: legacyPhone,
      email: legacyEmail,
      source: "OTHER",
      searchKeyword: "legacy-upgrade-seed",
      idempotencyKey: `legacy-upgrade-seed-${suffix}`,
      payloadHash: "d".repeat(64),
      dedupKey: legacyOldDedupKey,
    },
  });
  const legacyCountBefore = await rootClient.lead.count();
  const legacyUpgradePayload = {
    companyName: legacyIncomingCompanyName,
    source: "OTHER" as const,
    searchKeyword: "legacy-upgrade-new-hit",
    aiScore: 84,
    profile: { industry: "机械制造", compatibility: "legacy-upgrade" },
    sourceModelVersion: "acceptance-model-legacy-upgrade",
    extractorVersion: "acceptance-extractor-legacy-upgrade",
    sourceSystem: "ci-internal-script",
    externalLeadId: `${suffix}-legacy-upgrade-hit`,
  };
  const legacyUpgradeItem = {
    idempotencyKey: `lead-acceptance-${suffix}-legacy-upgrade-hit`,
    payloadHash: canonicalLeadPayloadHash(legacyUpgradePayload),
    ...legacyUpgradePayload,
  };
  const legacyUpgrade = await callLead(legacyUpgradeItem);
  const legacyUpgradeResult = legacyUpgrade.payload.result?.structuredContent?.data?.items?.[0];
  check(
    legacyUpgradeResult?.id === legacyLeadId
      && legacyUpgradeResult.replay === false
      && legacyUpgradeResult.writeDisposition === "MERGED",
    "Legacy company fingerprint did not resolve to the original Lead as MERGED",
  );
  check(await rootClient.lead.count() === legacyCountBefore, "Legacy company fingerprint created a second Lead");
  const migratedLegacyLead = await rootClient.lead.findUnique({ where: { id: legacyLeadId } });
  check(migratedLegacyLead?.dedupKey === legacyNewDedupKey, "Legacy Lead dedupKey was not lazily migrated to the company-only fingerprint");
  check(migratedLegacyLead.searchKeyword === "legacy-upgrade-seed；legacy-upgrade-new-hit", "Legacy Lead fields were not merged after lazy migration");
  const legacyUpgradeAudits = await rootClient.leadWriteAudit.findMany({
    where: { idempotencyKey: legacyUpgradeItem.idempotencyKey },
    select: { entityId: true, outcome: true },
  });
  check(
    legacyUpgradeAudits.length === 1
      && legacyUpgradeAudits[0].entityId === legacyLeadId
      && legacyUpgradeAudits[0].outcome === "CREATED",
    "Legacy Lead lazy migration audit was not recorded against the original Lead",
  );

  const historicalSuffix = randomUUID();
  const historicalRootId = randomUUID();
  const historicalDuplicateId = randomUUID();
  const historicalRootCompanyName = `Historical Root（${historicalSuffix}）有限公司`;
  const historicalIncomingCompanyName = `historical root ${historicalSuffix} 有限公司`;
  const historicalRootPhone = "13800000002";
  const historicalOldDedupKey = legacyDedupFingerprint(historicalRootCompanyName, historicalRootPhone);
  const historicalNewDedupKey = companyDedupFingerprint(historicalIncomingCompanyName);
  await rootClient.lead.createMany({
    data: [
      {
        id: historicalRootId,
        companyName: historicalRootCompanyName,
        phone: historicalRootPhone,
        source: "OTHER",
        searchKeyword: "historical-root-seed",
        idempotencyKey: `historical-root-seed-${historicalSuffix}`,
        payloadHash: "e".repeat(64),
        dedupKey: historicalOldDedupKey,
        duplicateOfLeadId: null,
        dedupStatus: "UNIQUE",
        createdAt: new Date("2026-08-14T00:00:00.000Z"),
      },
      {
        id: historicalDuplicateId,
        companyName: historicalIncomingCompanyName,
        contactName: "历史重复联系人",
        source: "OTHER",
        searchKeyword: "historical-duplicate-seed",
        idempotencyKey: `historical-duplicate-seed-${historicalSuffix}`,
        payloadHash: "f".repeat(64),
        dedupKey: null,
        duplicateOfLeadId: historicalRootId,
        duplicateConfidence: 95,
        dedupStatus: "PENDING_REVIEW",
        // duplicate 故意更早，验证选择规则仍固定优先 root。
        createdAt: new Date("2026-08-13T00:00:00.000Z"),
      },
    ],
  });
  const historicalCountBefore = await rootClient.lead.count();
  const historicalPayload = {
    companyName: historicalIncomingCompanyName,
    source: "OTHER" as const,
    searchKeyword: "historical-new-hit",
    aiScore: 86,
    profile: { industry: "机床制造", compatibility: "historical-root-selection" },
    sourceModelVersion: "acceptance-model-historical-root",
    extractorVersion: "acceptance-extractor-historical-root",
    sourceSystem: "ci-internal-script",
    externalLeadId: `${historicalSuffix}-new-hit`,
  };
  const historicalItem = {
    idempotencyKey: `lead-acceptance-${historicalSuffix}-historical-root-hit`,
    payloadHash: canonicalLeadPayloadHash(historicalPayload),
    ...historicalPayload,
  };
  const historicalWrite = await callLead(historicalItem);
  const historicalResult = historicalWrite.payload.result?.structuredContent?.data?.items?.[0];
  check(
    historicalResult?.id === historicalRootId
      && historicalResult.replay === false
      && historicalResult.writeDisposition === "MERGED",
    "Historical duplicate set did not select the root Lead as MERGED",
  );
  check(await rootClient.lead.count() === historicalCountBefore, "Historical duplicate set created a third Lead");
  const historicalRoot = await rootClient.lead.findUnique({ where: { id: historicalRootId } });
  const historicalDuplicate = await rootClient.lead.findUnique({ where: { id: historicalDuplicateId } });
  check(historicalRoot?.dedupKey === historicalNewDedupKey, "Historical root dedupKey was not lazily migrated");
  check(historicalRoot.searchKeyword === "historical-root-seed；historical-new-hit", "Historical root did not receive the new merge");
  check(historicalDuplicate?.duplicateOfLeadId === historicalRootId && historicalDuplicate.dedupStatus === "PENDING_REVIEW", "Historical duplicate was unexpectedly changed");
  check(historicalDuplicate.searchKeyword === "historical-duplicate-seed", "Historical duplicate received the merge instead of the root");
  const historicalAudits = await rootClient.leadWriteAudit.findMany({
    where: { idempotencyKey: historicalItem.idempotencyKey },
    select: { entityId: true, outcome: true },
  });
  check(
    historicalAudits.length === 1
      && historicalAudits[0].entityId === historicalRootId
      && historicalAudits[0].outcome === "CREATED",
    "Historical root selection audit was not recorded against the root Lead",
  );

  const businessPayload = {
    companyName: `Lead 写隔离验收 ${suffix}`,
    contactName: "验收联系人",
    phone: "13800000000",
    email: `lead-${suffix}@example.invalid`,
    source: "OTHER" as const,
    searchKeyword: "隔离验收",
    aiScore: 87,
    profile: { industry: "机械制造", intent: "设备询价" },
    sourceModelVersion: "acceptance-model-1",
    extractorVersion: "acceptance-extractor-1",
    sourceSystem: "ci-internal-script",
    externalLeadId: suffix,
  };
  const item = {
    idempotencyKey: `lead-acceptance-${suffix}`,
    payloadHash: canonicalLeadPayloadHash(businessPayload),
    ...businessPayload,
  };
  const created = await callLead(item);
  check(created.payload.result?.structuredContent?.ok === true, "Lead creation failed");
  const createdItem = created.payload.result.structuredContent.data?.items?.[0];
  check(
    createdItem?.replay === false
      && createdItem.writeDisposition === "CREATED"
      && createdItem.routingOutcome === "REGION_UNRESOLVED"
      && typeof createdItem.id === "string",
    "Lead creation did not return CREATED with routing outcome",
  );
  const entityId = createdItem.id;

  const replay = await callLead(item);
  const replayItem = replay.payload.result?.structuredContent?.data?.items?.[0];
  check(replayItem?.id === entityId, "Replay did not return the original Lead");
  check(replayItem.replay === true && replayItem.writeDisposition === "REPLAY", "Replay did not return REPLAY");

  const conflictingPayload = { ...businessPayload, companyName: `${businessPayload.companyName} 冲突` };
  const conflict = await callLead({
    ...item,
    ...conflictingPayload,
    payloadHash: canonicalLeadPayloadHash(conflictingPayload),
  });
  check(conflict.payload.result?.structuredContent?.error?.code === "IDEMPOTENCY_CONFLICT", "Idempotency conflict was not rejected");

  const mergedPayload = {
    ...businessPayload,
    contactName: "不得覆盖的新联系人",
    phone: "13900000000",
    email: `new-${suffix}@example.invalid`,
    searchKeyword: "二次命中关键词",
    aiScore: 93,
    profile: { industry: "机床制造", intent: "明确采购", confidence: "high" },
    sourceModelVersion: "acceptance-model-2",
    extractorVersion: "acceptance-extractor-2",
    externalLeadId: `${suffix}-second-hit`,
  };
  const mergedItem = {
    idempotencyKey: `lead-acceptance-${suffix}-second-hit`,
    payloadHash: canonicalLeadPayloadHash(mergedPayload),
    ...mergedPayload,
  };
  const merged = await callLead(mergedItem);
  const mergedResult = merged.payload.result?.structuredContent?.data?.items?.[0];
  check(
    mergedResult?.id === entityId
      && mergedResult.replay === false
      && mergedResult.writeDisposition === "MERGED"
      && mergedResult.routingOutcome === null,
    "Same-company hit did not return MERGED for the original Lead",
  );
  const mergedReplay = await callLead(mergedItem);
  const mergedReplayResult = mergedReplay.payload.result?.structuredContent?.data?.items?.[0];
  check(
    mergedReplayResult?.id === entityId
      && mergedReplayResult.replay === true
      && mergedReplayResult.writeDisposition === "REPLAY",
    "Merged idempotency key did not return REPLAY",
  );
  const mergedLead = await rootClient.lead.findUnique({ where: { id: entityId } });
  check(mergedLead?.contactName === businessPayload.contactName, "Existing contact name was overwritten");
  check(mergedLead.phone === businessPayload.phone && mergedLead.email === businessPayload.email, "Existing phone or email was overwritten");
  check(mergedLead.aiScore === 93 && mergedLead.sourceModelVersion === "acceptance-model-2", "Latest valid score metadata was not merged");
  check(mergedLead.searchKeyword === `${businessPayload.searchKeyword}；${mergedPayload.searchKeyword}`, "Search keywords were not accumulated");
  const receipts = await rootClient.leadWriteIdempotency.findMany({ where: { leadId: entityId } });
  check(receipts.length === 2, "Merged Lead did not retain both idempotency receipts");

  const concurrentCompany = `Lead 并发企业验收 ${randomUUID()}`;
  const concurrentBasePayload = {
    companyName: concurrentCompany,
    source: "OTHER" as const,
    searchKeyword: "并发基础关键词",
    aiScore: 69,
    profile: { industry: "机械制造", concurrency: "base" },
    sourceModelVersion: "acceptance-model-concurrent",
    extractorVersion: "acceptance-extractor-concurrent",
    sourceSystem: "ci-internal-script",
    externalLeadId: `${suffix}-concurrent-base`,
  };
  const concurrentBaseItem = {
    idempotencyKey: `lead-acceptance-${suffix}-concurrent-base`,
    payloadHash: canonicalLeadPayloadHash(concurrentBasePayload),
    ...concurrentBasePayload,
  };
  const concurrentBase = await callLead(concurrentBaseItem);
  const concurrentBaseId = concurrentBase.payload.result?.structuredContent?.data?.items?.[0]?.id;
  check(typeof concurrentBaseId === "string", "Concurrent merge base Lead was not created");
  const concurrentPayloads = ["a", "b"].map((part, index) => ({
    companyName: concurrentCompany,
    phone: index === 0 ? "13700000000" : "13600000000",
    source: "OTHER" as const,
    searchKeyword: `并发关键词-${part}`,
    aiScore: 70 + index,
    profile: { industry: "机械制造", concurrency: part },
    sourceModelVersion: "acceptance-model-concurrent",
    extractorVersion: "acceptance-extractor-concurrent",
    sourceSystem: "ci-internal-script",
    externalLeadId: `${suffix}-concurrent-${part}`,
  }));
  const concurrentItems = concurrentPayloads.map((payload, index) => ({
    idempotencyKey: `lead-acceptance-${suffix}-concurrent-${index}`,
    payloadHash: canonicalLeadPayloadHash(payload),
    ...payload,
  }));
  const concurrentWrites = await Promise.all(concurrentItems.map(callLead));
  const concurrentIds = concurrentWrites.map((entry) => entry.payload.result?.structuredContent?.data?.items?.[0]?.id);
  check(concurrentIds.every((id) => id === concurrentBaseId), "Concurrent same-company writes did not converge on the existing Lead");
  check(await rootClient.lead.count({ where: { companyName: concurrentCompany } }) === 1, "Concurrent same-company writes created more than one Lead");
  const concurrentLead = await rootClient.lead.findUnique({ where: { id: concurrentBaseId } });
  const concurrentKeywords = new Set(String(concurrentLead?.searchKeyword || "").split("；"));
  check(
    ["并发基础关键词", "并发关键词-a", "并发关键词-b"].every((keyword) => concurrentKeywords.has(keyword)),
    "Concurrent same-company writes lost a search keyword",
  );
  check(new Set(["13700000000", "13600000000"]).has(String(concurrentLead?.phone)), "Concurrent contact fill was invalid");
  check(await rootClient.leadWriteIdempotency.count({ where: { leadId: concurrentBaseId } }) === 3, "Concurrent idempotency receipts were incomplete");

  const humanResponse = await handler(mcpRequest({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "lead_upsert", arguments: { items: [item] } },
  }, { humanOnly: true }));
  check(humanResponse.status === 400, "Human SUPER_ADMIN path was not rejected");

  for (const [name, token] of [["wrong audience", wrongAudience.token], ["missing scope", missingScopeToken]] as const) {
    const response = await handler(mcpRequest({
      jsonrpc: "2.0",
      id: `negative-${name}`,
      method: "tools/call",
      params: { name: "lead_upsert", arguments: { items: [item] } },
    }, { serviceAssertion: token }));
    check(response.status === 401, `${name} service assertion was not rejected`);
  }

  const overLimitItems = Array.from({ length: 21 }, (_, index) => ({
    ...item,
    idempotencyKey: `${item.idempotencyKey}-limit-${index}`,
  }));
  const overLimitResponse = await handler(mcpRequest({
    jsonrpc: "2.0",
    id: "negative-batch-limit",
    method: "tools/call",
    params: { name: "lead_upsert", arguments: { items: overLimitItems } },
  }));
  const overLimitPayload = await overLimitResponse.json() as McpJsonPayload;
  check(overLimitPayload.result?.structuredContent?.error?.code === "INVALID_ARGUMENT", "21-item batch was not rejected");

  const audits = await rootClient.$queryRaw<Array<{ outcome: string }>>`
    SELECT outcome FROM lead_write_audits
    WHERE idempotencyKey = ${item.idempotencyKey}
    ORDER BY createdAt ASC
  `;
  check(audits.map((entry) => entry.outcome).join(",") === "CREATED,REPLAY,CONFLICT", "Lead write audit outcomes are incomplete");
  const mergedAudits = await rootClient.leadWriteAudit.findMany({
    where: { idempotencyKey: mergedItem.idempotencyKey },
    select: { outcome: true },
    orderBy: { createdAt: "asc" },
  });
  check(mergedAudits.map((entry) => entry.outcome).join(",") === "CREATED,REPLAY", "Merged idempotency audit outcomes are incomplete");
  console.log("LEAD_WRITE_ISOLATION_ACCEPTANCE=PASS catalog=1 legacyUpgrade=1 historicalRootSelection=1 created=1 merged=1 replay=2 conflict=1 companyConcurrency=1 audit=7 humanDenied=1 wrongAudienceDenied=1 missingScopeDenied=1 batchLimitDenied=1");
} finally {
  await Promise.all([commandClient.$disconnect(), rootClient.$disconnect()]);
}
}

void main().catch((error: unknown) => {
  console.error(`LEAD_WRITE_ISOLATION_ACCEPTANCE=FAIL error=${error instanceof Error ? error.name : "UnknownError"}`);
  process.exitCode = 1;
});
