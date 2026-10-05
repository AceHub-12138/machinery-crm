import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { importJWK, SignJWT, type JWK } from "jose";
import { createAgentAuthRuntime, loadAgentAuthConfig } from "@/lib/agent-auth/config";
import { MCP_TOOL_NAMES, MCP_TOOL_ROLE_MATRIX } from "@/lib/mcp/tools";
import type { McpRole } from "@/lib/mcp/application";
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

type RpcBody = {
  result?: {
    serverInfo?: unknown;
    tools?: Array<{ name: string }>;
    structuredContent?: {
      data?: Record<string, unknown>;
      meta?: { requestId?: string };
      error?: { code?: string } | null;
    };
  };
  error?: unknown;
};
type RpcResult = { status: number; body: RpcBody | null; text: string };

if (process.env.IDENTITY_ACCEPTANCE_ENV !== "isolated") {
  throw new Error("Refusing to run outside IDENTITY_ACCEPTANCE_ENV=isolated");
}
const databaseUrl = new URL(process.env.DATABASE_URL || "");
if (databaseUrl.hostname !== "mysql") throw new Error("Acceptance database must be the isolated mysql service");

const required = (name: string) => {
  const value = String(process.env[name] || "").trim();
  if (!value || value.startsWith("REPLACE_") || value.startsWith("GENERATE_")) {
    throw new Error(`${name} is not configured`);
  }
  return value;
};

const serviceKey = required("MCP_SERVICE_KEY");
const mcpUrl = required("ACCEPTANCE_MCP_URL");
const fastGptUrl = required("ACCEPTANCE_FASTGPT_URL").replace(/\/$/, "");
const crmUrl = required("ACCEPTANCE_CRM_URL").replace(/\/$/, "");
const userPassword = required("ACCEPTANCE_USER_PASSWORD");
required("AGENT_GATEWAY_FASTGPT_API_KEY");

const prisma = new PrismaClient();
const runtime = await createAgentAuthRuntime(loadAgentAuthConfig());
const resourceTracker = createAcceptanceResourceTracker();
const transcripts: string[] = [];
const passed: string[] = [];
const evidenceRequestIds: string[] = [];
const expectedAuditUserIds = new Map<string, string>();
const startedAt = new Date().toISOString();
const acceptanceCustomerIds = {
  a: "00000000-0000-4000-8000-00000000000a",
  b: "00000000-0000-4000-8000-00000000000b",
} as const;
let acceptanceError: unknown;
let sensitiveScanStatus: AcceptanceEvidence["sensitiveScanStatus"] = "NOT_RUN";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function record(name: string) {
  passed.push(name);
  console.log(`[PASS] ${name}`);
}

function unwrap<T = unknown>(payload: unknown): T {
  return payload && typeof payload === "object" && "data" in payload
    ? (payload as { data: unknown }).data as T
    : payload as T;
}

async function rpc(
  method: string,
  params: Record<string, unknown>,
  options: { assertion?: string; requestId?: string | null; service?: string } = {},
): Promise<RpcResult> {
  const requestId = options.requestId === null ? null : options.requestId || `accept-${randomUUID()}`;
  if (requestId) evidenceRequestIds.push(requestId);
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${options.service ?? serviceKey}`,
    "content-type": "application/json",
  });
  if (requestId) headers.set("x-dachuan-request-id", requestId);
  if (options.assertion) headers.set("x-dachuan-user-assertion", options.assertion);
  const response = await trackedFetch(resourceTracker, mcpUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }),
  });
  const text = await readTrackedResponseText(resourceTracker, response);
  transcripts.push(text);
  let body: RpcBody | null = null;
  try { body = JSON.parse(text) as RpcBody; } catch { /* surfaced by assertions below */ }
  return { status: response.status, body, text };
}

function toolData(result: RpcResult) {
  return result.body?.result?.structuredContent?.data;
}

function toolErrorCode(result: RpcResult) {
  return result.body?.result?.structuredContent?.error?.code;
}

const fullReadOnly = String(process.env.MCP_TOOL_MODE || "").toUpperCase() === "FULL_READ_ONLY";

const keys = JSON.parse(required("AGENT_AUTH_KEYS_JSON")) as Array<{
  kid: string;
  publicJwk: JWK;
  privateJwk?: JWK;
}>;
const activeKid = required("AGENT_AUTH_ACTIVE_KID");
const active = keys.find((entry) => entry.kid === activeKid && entry.privateJwk);
if (!active?.privateJwk) throw new Error("Active acceptance signing key is missing");
const signingKey = await importJWK(active.privateJwk, "EdDSA");

async function customToken(options: {
  userId?: string;
  issuer?: string;
  audience?: string;
  kid?: string;
  nowSeconds?: number;
}) {
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const jti = `acceptance-${randomUUID()}`;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA", kid: options.kid ?? activeKid, typ: "JWT" })
    .setIssuer(options.issuer ?? required("AGENT_AUTH_ISSUER"))
    .setSubject(options.userId ?? "identity-acceptance-sales-a")
    .setAudience(options.audience ?? required("AGENT_AUTH_AUDIENCE"))
    .setIssuedAt(nowSeconds)
    .setNotBefore(nowSeconds)
    .setExpirationTime(nowSeconds + 600)
    .setJti(jti)
    .sign(signingKey);
  await runtime.stateStore.register(jti, 600);
  return { token, jti };
}

async function crmGatewayAssertion(userId: string, role = "SUPER_ADMIN") {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + 600)
    .setJti(`gateway-${randomUUID()}`)
    .sign(new TextEncoder().encode(required("CRM_AGENT_ASSERTION_SECRET")));
}

async function fastGptAdminToken() {
  const preLogin = await trackedFetch(resourceTracker, `${fastGptUrl}/api/support/user/account/preLogin?username=root`);
  const preLoginBody = unwrap<{ code: string }>(JSON.parse(await readTrackedResponseText(resourceTracker, preLogin)));
  check(preLogin.ok && preLoginBody.code, "FastGPT pre-login failed");
  const login = await trackedFetch(resourceTracker, `${fastGptUrl}/api/support/user/account/loginByPassword`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "root",
      password: createHash("sha256").update(required("FASTGPT_ROOT_PASSWORD")).digest("hex"),
      code: preLoginBody.code,
      language: "zh-CN",
    }),
  });
  const loginBody = unwrap<{ token: string }>(JSON.parse(await readTrackedResponseText(resourceTracker, login)));
  check(login.ok && loginBody.token, "FastGPT root login failed");
  return loginBody.token;
}

try {
  const loginPreflight = await runAcceptanceLoginPreflight({
    crmUrl,
    password: userPassword,
    users: acceptanceLoginUsers(process.env),
  });
  check(loginPreflight.diagnostics.length === 6, "CRM login preflight did not verify six users");
  const adminSession = loginPreflight.sessionsByUserId.get("identity-acceptance-admin");
  check(adminSession, "CRM login preflight did not return the SUPER_ADMIN session");
  record("six isolated CRM users complete real login and session preflight");

  const initialize = await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "identity-acceptance", version: "1.0.0" },
  });
  check(initialize.status === 200 && initialize.body?.result?.serverInfo, "MCP initialize failed");
  const catalog = await rpc("tools/list", {});
  check(catalog.status === 200, "MCP tools/list failed");
  const expectedCatalog = ["dachuan_identity_who_am_i", ...(fullReadOnly ? MCP_TOOL_NAMES : [])];
  check(catalog.body?.result?.tools?.length === expectedCatalog.length, `${fullReadOnly ? "FULL_READ_ONLY" : "IDENTITY_POC"} tool count mismatch`);
  check(expectedCatalog.every((name) => catalog.body?.result?.tools?.some((tool) => tool.name === name)), "Unexpected MCP tool catalog");
  const ping = await rpc("ping", {});
  check(ping.status === 200 && ping.body?.result, "MCP ping failed");
  record(`FastGPT service identity can initialize and discover ${fullReadOnly ? "25-tool FULL_READ_ONLY" : "IDENTITY_POC"} catalog`);

  const missingCatalogRequestId = await rpc("tools/list", {}, { requestId: null });
  check(missingCatalogRequestId.status === 400, "tools/list without caller requestId was not rejected");
  const invalidCatalogService = await rpc("tools/list", {}, { service: "invalid-service-key" });
  check(invalidCatalogService.status === 401, "tools/list with an invalid service key was not rejected");
  record("tools/list requires service key and caller requestId without requiring a user assertion");

  const noAssertion = await rpc("tools/call", {
    name: "dachuan_identity_who_am_i",
    arguments: {},
  });
  check(noAssertion.status === 400 && noAssertion.body?.error, "tools/call without assertion was not rejected");
  record("tools/call rejects missing user assertion");

  const issuedA = await runtime.tokenService.issue("identity-acceptance-sales-a");
  const issuedB = await runtime.tokenService.issue("identity-acceptance-sales-b");
  const normal = await rpc("tools/call", { name: "dachuan_identity_who_am_i", arguments: {} }, {
    assertion: issuedA.token,
    requestId: "accept-normal-sales-a",
  });
  check(normal.status === 200 && toolData(normal)?.userId === "identity-acceptance-sales-a", "Normal user identity failed");
  record("normal ERP user resolves from a signed assertion");

  if (fullReadOnly) {
    const userIdsByRole: Record<Exclude<McpRole, "AGENT_ACCOUNT">, string> = {
      SUPER_ADMIN: "identity-acceptance-admin",
      SALES: "identity-acceptance-sales-a",
      FOREIGN_TRADE: "identity-acceptance-sales-b",
      PURCHASE: "identity-acceptance-purchase",
      WAREHOUSE: "identity-acceptance-warehouse",
    };
    const [superAdminToken, salesToken, foreignTradeToken, purchaseToken, warehouseToken] = await Promise.all([
      runtime.tokenService.issue(userIdsByRole.SUPER_ADMIN),
      runtime.tokenService.issue(userIdsByRole.SALES),
      runtime.tokenService.issue(userIdsByRole.FOREIGN_TRADE),
      runtime.tokenService.issue(userIdsByRole.PURCHASE),
      runtime.tokenService.issue(userIdsByRole.WAREHOUSE),
    ]);
    const issuedByRole: Record<Exclude<McpRole, "AGENT_ACCOUNT">, { token: string; jti: string }> = {
      SUPER_ADMIN: superAdminToken,
      SALES: salesToken,
      FOREIGN_TRADE: foreignTradeToken,
      PURCHASE: purchaseToken,
      WAREHOUSE: warehouseToken,
    };
    const roles = Object.keys(userIdsByRole) as Exclude<McpRole, "AGENT_ACCOUNT">[];
    const validArguments: Record<string, Record<string, unknown>> = {
      lead_list: {},
      lead_get: { id: "10000000-0000-4000-8000-000000000001" },
      lead_stats: {},
      crm_customers_list: {},
      crm_customer_get: { id: acceptanceCustomerIds.a },
      crm_customer_follows_list: { customerId: acceptanceCustomerIds.a },
      crm_products_list: {},
      crm_product_get: { id: "identity-acceptance-product" },
      crm_contracts_list: {},
      crm_contract_get: { id: "identity-acceptance-contract-sales-a" },
      crm_shipments_list: {},
      crm_shipment_get: { id: "identity-acceptance-shipment-sales-a" },
      erp_suppliers_list: {},
      erp_supplier_get: { id: "identity-acceptance-supplier" },
      erp_purchase_orders_list: {},
      erp_purchase_order_get: { id: "identity-acceptance-purchase-order" },
      erp_inventory_list: {},
      erp_stock_documents_list: { direction: "IN" },
      erp_stock_movements_list: {},
      erp_boms_list: {},
      erp_bom_get: { id: "identity-acceptance-bom" },
      erp_production_orders_list: {},
      erp_production_order_get: { id: "identity-acceptance-production-order" },
      erp_kit_check: { productionOrderId: "identity-acceptance-production-order" },
    };
    const forgedIdentity = {
      userId: "forged-user",
      role: "SUPER_ADMIN",
      region: "全国",
      territories: [{ province: "任意", cities: [] }],
      viewScope: "ALL",
    };
    const foreignTradeArguments: Partial<Record<string, Record<string, unknown>>> = {
      crm_customer_get: { id: acceptanceCustomerIds.b },
      crm_customer_follows_list: { customerId: acceptanceCustomerIds.b },
      crm_contract_get: { id: "identity-acceptance-contract-sales-b" },
      crm_shipment_get: { id: "identity-acceptance-shipment-sales-b" },
    };
    let matrixCellCount = 0;

    for (const [index, toolName] of MCP_TOOL_NAMES.entries()) {
      const allowedRole = MCP_TOOL_ROLE_MATRIX[toolName][0] as Exclude<McpRole, "AGENT_ACCOUNT">;
      for (const role of roles) {
        const requestId = `full-matrix-${index}-${role.toLowerCase()}`;
        const argumentsForRole = role === "FOREIGN_TRADE"
          ? (foreignTradeArguments[toolName] || validArguments[toolName])
          : validArguments[toolName];
        const matrixResult = await rpc("tools/call", { name: toolName, arguments: argumentsForRole }, {
          assertion: issuedByRole[role].token,
          requestId,
        });
        matrixCellCount += 1;
        expectedAuditUserIds.set(requestId, userIdsByRole[role]);
        if (MCP_TOOL_ROLE_MATRIX[toolName].includes(role)) {
          check(
            matrixResult.status === 200 && toolErrorCode(matrixResult) === undefined && toolData(matrixResult) !== undefined,
            `${toolName}/${role} allowed matrix cell did not complete a successful read`,
          );
        } else {
          check(toolErrorCode(matrixResult) === "FORBIDDEN", `${toolName}/${role} forbidden matrix cell was not denied`);
        }
      }

      const forged = await rpc("tools/call", { name: toolName, arguments: { ...validArguments[toolName], ...forgedIdentity } }, {
        assertion: issuedByRole[allowedRole].token,
        requestId: `full-forged-${index}`,
      });
      expectedAuditUserIds.set(`full-forged-${index}`, userIdsByRole[allowedRole]);
      check(toolErrorCode(forged) === "INVALID_ARGUMENT", `${toolName} accepted forged identity arguments`);
    }
    check(matrixCellCount === 120, `Expected 120 role/tool matrix cells, received ${matrixCellCount}`);
    record("all 24 business tools execute the complete five-role permission matrix (120 cells) and reject forged identity arguments");

    const [salesAList, salesBList] = await Promise.all([
      rpc("tools/call", { name: "crm_customers_list", arguments: { search: "身份验收" } }, {
        assertion: issuedByRole.SALES.token,
        requestId: "full-sales-a-region",
      }),
      rpc("tools/call", { name: "crm_customers_list", arguments: { search: "身份验收" } }, {
        assertion: issuedByRole.FOREIGN_TRADE.token,
        requestId: "full-sales-b-region",
      }),
    ]);
    const salesAItems = (toolData(salesAList)?.items || []) as Array<{ id?: string }>;
    const salesBItems = (toolData(salesBList)?.items || []) as Array<{ id?: string }>;
    check(salesAItems.some((item) => item.id === acceptanceCustomerIds.a), "Domestic sales did not receive its own regional customer");
    check(!salesAItems.some((item) => item.id === acceptanceCustomerIds.b), "Domestic sales received foreign-trade data");
    check(salesBItems.some((item) => item.id === acceptanceCustomerIds.b), "Foreign trade did not receive its own business-line customer");
    check(!salesBItems.some((item) => item.id === acceptanceCustomerIds.a), "Foreign trade received domestic regional data");
    record("two concurrent sales identities remain isolated by business line and territory");

    const scopedCases = [
      {
        name: "crm_customer_get",
        ownArgs: { id: acceptanceCustomerIds.a },
        crossArgs: { id: acceptanceCustomerIds.b },
        ownId: acceptanceCustomerIds.a,
        crossMode: "NOT_FOUND",
      },
      {
        name: "crm_customer_follows_list",
        ownArgs: { customerId: acceptanceCustomerIds.a },
        crossArgs: { customerId: acceptanceCustomerIds.b },
        ownId: "identity-acceptance-follow-sales-a",
        crossMode: "EMPTY_LIST",
      },
      {
        name: "crm_contracts_list",
        ownArgs: { customerId: acceptanceCustomerIds.a },
        crossArgs: { customerId: acceptanceCustomerIds.b },
        ownId: "identity-acceptance-contract-sales-a",
        crossMode: "EMPTY_LIST",
      },
      {
        name: "crm_contract_get",
        ownArgs: { id: "identity-acceptance-contract-sales-a" },
        crossArgs: { id: "identity-acceptance-contract-sales-b" },
        ownId: "identity-acceptance-contract-sales-a",
        crossMode: "NOT_FOUND",
      },
      {
        name: "crm_shipments_list",
        ownArgs: { customerId: acceptanceCustomerIds.a },
        crossArgs: { customerId: acceptanceCustomerIds.b },
        ownId: "identity-acceptance-shipment-sales-a",
        crossMode: "EMPTY_LIST",
      },
      {
        name: "crm_shipment_get",
        ownArgs: { id: "identity-acceptance-shipment-sales-a" },
        crossArgs: { id: "identity-acceptance-shipment-sales-b" },
        ownId: "identity-acceptance-shipment-sales-a",
        crossMode: "NOT_FOUND",
      },
    ] as const;
    for (const [index, scopedCase] of scopedCases.entries()) {
      const own = await rpc("tools/call", { name: scopedCase.name, arguments: scopedCase.ownArgs }, {
        assertion: issuedByRole.SALES.token,
        requestId: `full-scope-own-${index}`,
      });
      const ownData = toolData(own);
      const ownItems = (ownData?.items || []) as Array<{ id?: string }>;
      check(
        toolErrorCode(own) === undefined && (ownData?.id === scopedCase.ownId || ownItems.some((item) => item.id === scopedCase.ownId)),
        `${scopedCase.name} did not return the domestic sales fixture`,
      );
      const cross = await rpc("tools/call", { name: scopedCase.name, arguments: scopedCase.crossArgs }, {
        assertion: issuedByRole.SALES.token,
        requestId: `full-scope-cross-${index}`,
      });
      if (scopedCase.crossMode === "NOT_FOUND") {
        check(toolErrorCode(cross) === "NOT_FOUND", `${scopedCase.name} exposed a cross-business-line detail`);
      } else {
        check(toolErrorCode(cross) === undefined && ((toolData(cross)?.items || []) as unknown[]).length === 0, `${scopedCase.name} exposed a cross-business-line list item`);
      }
    }
    const [domesticProducts, foreignProducts] = await Promise.all([
      rpc("tools/call", { name: "crm_products_list", arguments: { search: "IDENTITY-ACCEPTANCE" } }, {
        assertion: issuedByRole.SALES.token,
        requestId: "full-global-products-sales",
      }),
      rpc("tools/call", { name: "crm_products_list", arguments: { search: "IDENTITY-ACCEPTANCE" } }, {
        assertion: issuedByRole.FOREIGN_TRADE.token,
        requestId: "full-global-products-foreign",
      }),
    ]);
    check(toolErrorCode(domesticProducts) === undefined && toolErrorCode(foreignProducts) === undefined, "Global product master was not readable by both CRM business lines");
    const [domesticProduct, foreignProduct] = await Promise.all([
      rpc("tools/call", { name: "crm_product_get", arguments: { id: "identity-acceptance-product" } }, {
        assertion: issuedByRole.SALES.token,
        requestId: "full-global-product-get-sales",
      }),
      rpc("tools/call", { name: "crm_product_get", arguments: { id: "identity-acceptance-product" } }, {
        assertion: issuedByRole.FOREIGN_TRADE.token,
        requestId: "full-global-product-get-foreign",
      }),
    ]);
    check(
      toolErrorCode(domesticProduct) === undefined
        && toolErrorCode(foreignProduct) === undefined
        && toolData(domesticProduct)?.id === "identity-acceptance-product"
        && toolData(foreignProduct)?.id === "identity-acceptance-product",
      "Global product detail was not readable by both CRM business lines",
    );
    record("all region-scoped CRM tools reject cross-business data; global and ERP tools follow their explicit module scopes");
  }

  const concurrentExpected = Array.from({ length: 48 }, (_, index) => ({
    userId: index % 2 ? "identity-acceptance-sales-b" : "identity-acceptance-sales-a",
    token: index % 2 ? issuedB.token : issuedA.token,
    requestId: `accept-concurrent-tab-${index % 6}-call-${index}`,
  }));
  const concurrent = await Promise.all(concurrentExpected.map((item) =>
    rpc("tools/call", { name: "dachuan_identity_who_am_i", arguments: {} }, {
      assertion: item.token,
      requestId: item.requestId,
    })));
  concurrent.forEach((result, index) => {
    check(toolData(result)?.userId === concurrentExpected[index].userId, `Concurrent identity mismatch at ${index}`);
    check(result.body?.result?.structuredContent?.meta?.requestId === concurrentExpected[index].requestId, `Concurrent requestId mismatch at ${index}`);
  });
  record("48 interleaved user/session/tab calls remain isolated");

  const valid = await customToken({});
  const [tamperedHeader, tamperedPayload, tamperedSignature] = valid.token.split(".");
  const tampered = `${tamperedHeader}.${tamperedPayload}.${tamperedSignature.startsWith("A") ? "B" : "A"}${tamperedSignature.slice(1)}`;
  const invalidCases = [
    { name: "tampered", token: tampered },
    { name: "expired", token: (await customToken({ nowSeconds: Math.floor(Date.now() / 1000) - 1200 })).token },
    { name: "issuer", token: (await customToken({ issuer: "http://wrong-issuer" })).token },
    { name: "audience", token: (await customToken({ audience: "wrong-audience" })).token },
    { name: "kid", token: (await customToken({ kid: "unknown-kid" })).token },
  ];
  for (const item of invalidCases) {
    const result = await rpc("tools/call", { name: "dachuan_identity_who_am_i", arguments: {} }, {
      assertion: item.token,
      requestId: `accept-invalid-${item.name}`,
    });
    check(result.status === 401 && result.body?.error, `${item.name} token was not rejected`);
  }
  record("tampered, expired, wrong iss/aud/kid assertions are rejected");

  const revoked = await runtime.tokenService.issue("identity-acceptance-sales-a");
  await runtime.stateStore.revoke(revoked.jti, 600);
  const revokedResult = await rpc("tools/call", { name: "dachuan_identity_who_am_i", arguments: {} }, {
    assertion: revoked.token,
    requestId: "accept-revoked-jti",
  });
  check(revokedResult.status === 401, "Revoked JTI was not rejected");
  record("JTI revocation takes effect immediately");

  const realtime = await runtime.tokenService.issue("identity-acceptance-sales-a");
  await prisma.user.update({
    where: { id: "identity-acceptance-sales-a" },
    data: { role: "PURCHASE", region: "实时变更区", territories: [], viewScope: "ALL" },
  });
  const changed = await rpc("tools/call", { name: "dachuan_identity_who_am_i", arguments: {} }, {
    assertion: realtime.token,
    requestId: "accept-role-region-changed",
  });
  check(toolData(changed)?.role === "PURCHASE" && toolData(changed)?.region === "实时变更区", "Role/region change was not read in real time");
  await prisma.user.update({ where: { id: "identity-acceptance-sales-a" }, data: { isActive: false } });
  const disabled = await rpc("tools/call", { name: "dachuan_identity_who_am_i", arguments: {} }, {
    assertion: realtime.token,
    requestId: "accept-user-disabled",
  });
  check(disabled.status === 403, "Disabled user was not rejected immediately");
  record("database role/region changes and disablement take effect immediately");

  await prisma.user.update({
    where: { id: "identity-acceptance-sales-a" },
    data: {
      isActive: true,
      role: "SALES",
      region: "华东",
      territories: [{ province: "山东省", cities: ["济南市"] }],
      viewScope: "TERRITORY",
    },
  });

  const fastGptToken = await fastGptAdminToken();
  const discovery = await trackedFetch(resourceTracker, `${fastGptUrl}/api/core/app/mcpTools/getTools`, {
    method: "POST",
    headers: { "content-type": "application/json", token: fastGptToken },
    body: JSON.stringify({
      url: mcpUrl,
      headerSecret: { Authorization: { value: `Bearer ${serviceKey}` } },
    }),
  });
  const discoveryText = await readTrackedResponseText(resourceTracker, discovery);
  transcripts.push(discoveryText);
  const discovered = unwrap<Array<{ name?: string }>>(JSON.parse(discoveryText) as unknown);
  check(discovery.ok && Array.isArray(discovered), "FastGPT admin MCP discovery failed");
  check(discovered.some((tool) => tool.name === "dachuan_identity_who_am_i"), "FastGPT did not discover who_am_i");
  record("FastGPT 4.15.1 admin endpoint completes initialize and tools/list without a user assertion");

  const rejectedGatewayCalls = await Promise.all([
    trackedFetch(resourceTracker, `${crmUrl}/api/agent-gateway/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:18080" },
      body: JSON.stringify({ messages: [] }),
    }),
    trackedFetch(resourceTracker, `${crmUrl}/api/agent-gateway/chat`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await crmGatewayAssertion("identity-acceptance-sales-a", "SALES")}`,
        "content-type": "application/json",
        origin: "http://127.0.0.1:18080",
      },
      body: JSON.stringify({ messages: [] }),
    }),
  ]);
  check(rejectedGatewayCalls.every((response) => response.status === 401), "Gateway accepted a missing or non-SUPER_ADMIN CRM bearer assertion");
  record("Gateway rejects missing and non-SUPER_ADMIN CRM bearer assertions before FastGPT forwarding");

  const gatewayCases = Array.from({ length: 24 }, (_, index) => ({
    userId: "identity-acceptance-admin",
    marker: `super-admin-tab-${index % 6}-call-${index}`,
    stream: index % 5 === 0,
  }));
  const chatResponses = await Promise.all(gatewayCases.map(async (item) => trackedFetch(resourceTracker, `${crmUrl}/api/agent-gateway/chat`, {
    method: "POST",
    headers: {
      accept: item.stream ? "text/event-stream" : "application/json",
      authorization: `Bearer ${await crmGatewayAssertion(item.userId)}`,
      "content-type": "application/json",
      origin: "http://127.0.0.1:18080",
    },
    body: JSON.stringify({
      chatId: `identity-acceptance-${item.marker}-${randomUUID()}`,
      stream: item.stream,
      detail: true,
      messages: [{ role: "user", content: "调用 dachuan_identity_who_am_i，只返回当前 ERP userId。" }],
    }),
  })));
  const chatTexts = await Promise.all(chatResponses.map((response) => readTrackedResponseText(resourceTracker, response)));
  transcripts.push(...chatTexts);
  check(chatResponses.every((response) => response.ok), "CRM Gateway to FastGPT chat failed");
  gatewayCases.forEach((item, index) => {
    const contentType = chatResponses[index].headers.get("content-type") || "";
    if (item.stream) {
      check(contentType.includes("text/event-stream"), `Streaming response ${index} is not SSE`);
      check(chatTexts[index].includes("data:") && chatTexts[index].includes("[DONE]"), `Streaming response ${index} is incomplete`);
    }
  });
  const requestIds = chatResponses.map((response) => response.headers.get("x-dachuan-request-id"));
  check(requestIds.every(Boolean) && new Set(requestIds).size === 24, "Gateway requestIds are missing or reused");
  evidenceRequestIds.push(...requestIds.filter((value): value is string => Boolean(value)));
  const chatAudits = await prisma.operationLog.findMany({
    where: { entityId: { in: requestIds as string[] }, action: "MCP_CALL" },
    select: { userId: true, entityId: true, afterData: true },
  });
  gatewayCases.forEach((item, index) => {
    check(chatAudits.some((audit) => audit.userId === item.userId && audit.entityId === requestIds[index]), `Full-chain identity mismatch at ${index}`);
  });
  record("24 real multi-session/tab streaming and non-streaming calls traverse Gateway, FastGPT and MCP without identity crossover");

  const audits = await prisma.operationLog.findMany({
    where: { entityId: { in: [...new Set(evidenceRequestIds)] }, action: "MCP_CALL" },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { userId: true, entityId: true, afterData: true },
  });
  check(audits.some((item) => item.userId === "identity-acceptance-sales-a"), "Concrete ERP user missing from OperationLog");
  check(audits.some((item) => item.entityId === "accept-invalid-audience"), "Rejected request missing from OperationLog");
  if (fullReadOnly) {
    const allowedAuditKeys = ["apiKeyName", "createdAt", "durationMs", "method", "rejectionReason", "requestId", "statusCode", "success", "toolName"];
    const matrixRoles: McpRole[] = ["SUPER_ADMIN", "SALES", "FOREIGN_TRADE", "PURCHASE", "WAREHOUSE"];
    for (const [index, toolName] of MCP_TOOL_NAMES.entries()) {
      const expected = [
        ...matrixRoles.map((role) => {
          const success = MCP_TOOL_ROLE_MATRIX[toolName].includes(role);
          return {
            requestId: `full-matrix-${index}-${role.toLowerCase()}`,
            success,
            rejectionReason: success ? null : "FORBIDDEN",
          };
        }),
        { requestId: `full-forged-${index}`, success: false, rejectionReason: "INVALID_ARGUMENT" },
      ];
      for (const item of expected) {
        const audit = audits.find((entry) => entry.entityId === item.requestId);
        check(audit, `${item.requestId} has no OperationLog record`);
        check(audit.userId === expectedAuditUserIds.get(item.requestId), `${item.requestId} OperationLog userId mismatch`);
        const afterData = audit.afterData && typeof audit.afterData === "object" && !Array.isArray(audit.afterData)
          ? audit.afterData as Record<string, unknown>
          : {};
        check(afterData.requestId === item.requestId, `${item.requestId} audit requestId mismatch`);
        check(afterData.toolName === toolName, `${item.requestId} audit toolName mismatch`);
        check(afterData.success === item.success, `${item.requestId} audit success mismatch`);
        check((afterData.rejectionReason ?? null) === item.rejectionReason, `${item.requestId} audit rejectionReason mismatch`);
        check(Object.keys(afterData).sort().join(",") === [...allowedAuditKeys].sort().join(","), `${item.requestId} audit contains non-minimal fields`);
      }
    }
  }
  const auditText = JSON.stringify(audits);
  const sensitiveValues = [
    serviceKey,
    issuedA.token,
    issuedB.token,
    String(active.privateJwk.d || ""),
    required("MYSQL_PASSWORD"),
    required("REDIS_PASSWORD"),
    required("ACCEPTANCE_USER_PASSWORD"),
    required("FASTGPT_ROOT_PASSWORD"),
    required("FASTGPT_ROOT_KEY"),
    required("FASTGPT_TOKEN_KEY"),
    required("FASTGPT_FILE_TOKEN_KEY"),
    required("FASTGPT_AES_KEY"),
    required("FASTGPT_INVOKE_TOKEN_SECRET"),
    required("FASTGPT_MONGO_PASSWORD"),
    required("FASTGPT_REDIS_PASSWORD"),
    required("FASTGPT_MINIO_PASSWORD"),
    required("FASTGPT_PG_PASSWORD"),
    required("AGENT_GATEWAY_FASTGPT_API_KEY"),
  ].filter((value) => value.length >= 8);
  check(sensitiveValues.every((secret) => !auditText.includes(secret)), "Sensitive value found in OperationLog");
  check(sensitiveValues.every((secret) => transcripts.every((text) => !text.includes(secret))), "Sensitive value found in tool responses");
  const dynamicSecretPattern = /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
  check(!dynamicSecretPattern.test(auditText), "JWT-shaped assertion found in OperationLog");
  check(transcripts.every((text) => !dynamicSecretPattern.test(text)), "JWT-shaped assertion found in a tool or chat response");
  sensitiveScanStatus = "PASS";
  record("OperationLog is attributable and audit/tool outputs contain no configured secrets");
} catch (error) {
  acceptanceError = error;
  throw error;
} finally {
  await prisma.user.updateMany({
    where: { id: "identity-acceptance-sales-a" },
    data: {
      isActive: true,
      role: "SALES",
      region: "华东",
      territories: [{ province: "山东省", cities: ["济南市"] }],
      viewScope: "TERRITORY",
    },
  }).catch(() => undefined);
  const evidence: AcceptanceEvidence = {
    overallStatus: acceptanceError ? "FAIL" : "PASS",
    checks: [...passed],
    imageIds: {
      fastGpt: String(process.env.ACCEPTANCE_FASTGPT_IMAGE_ID || "unknown"),
      crmMcp: String(process.env.ACCEPTANCE_CRM_IMAGE_ID || "unknown"),
      runner: String(process.env.ACCEPTANCE_RUNNER_IMAGE_ID || "unknown"),
    },
    startedAt,
    completedAt: new Date().toISOString(),
    requestIdSummary: requestIdSummary(evidenceRequestIds),
    sensitiveScanStatus,
    ...(acceptanceError ? { failure: safeFailureMessage(acceptanceError) } : {}),
  };
  writeAcceptanceEvidenceAtomic(evidence);
  if (!acceptanceError) console.log(`IDENTITY_ACCEPTANCE_RESULT=PASS (${passed.length} checks)`);
  armNaturalExitWatchdog();
  await cleanupAcceptanceResources({ prisma, stateStore: runtime.stateStore, tracker: resourceTracker });
}
