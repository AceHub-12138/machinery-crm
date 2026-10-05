import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [templateArg, outputArg] = process.argv.slice(2);
if (!templateArg || !outputArg) throw new Error("Usage: node prepare-env.mjs <template> <output>");
const template = resolve(templateArg);
const output = resolve(outputArg);
const secret = (bytes = 32) => randomBytes(bytes).toString("base64url");
const serviceKey = `dcp_accept_${secret(32)}`;
const serviceHash = createHash("sha256").update(serviceKey).digest("hex");
const leadServiceKey = `dcp_lead_accept_${secret(32)}`;
const leadServiceHash = createHash("sha256").update(leadServiceKey).digest("hex");
const mysqlPassword = secret(24);
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const keys = JSON.stringify([{
  kid: "identity-acceptance-1",
  publicJwk: publicKey.export({ format: "jwk" }),
  privateJwk: privateKey.export({ format: "jwk" }),
}]);
const humanPublicKeys = JSON.stringify([{
  kid: "identity-acceptance-1",
  publicJwk: publicKey.export({ format: "jwk" }),
}]);
const leadKeys = generateKeyPairSync("ed25519");
const leadPublicKeys = JSON.stringify([{
  kid: "lead-service-acceptance-1",
  publicJwk: leadKeys.publicKey.export({ format: "jwk" }),
}]);
const replacements = {
  GENERATE_MYSQL_PASSWORD: mysqlPassword,
  GENERATE_MYSQL_ROOT_PASSWORD: secret(24),
  GENERATE_MCP_QUERY_DB_PASSWORD: secret(24),
  GENERATE_MCP_AUDIT_DB_PASSWORD: secret(24),
  GENERATE_MCP_COMMAND_DB_PASSWORD: secret(24),
  GENERATE_REDIS_PASSWORD: secret(24),
  GENERATE_AUTH_SECRET: secret(48),
  GENERATE_MCP_SERVICE_KEY_HASH: serviceHash,
  GENERATE_MCP_SERVICE_KEY: serviceKey,
  GENERATE_MCP_LEAD_SERVICE_KEY_HASH: leadServiceHash,
  GENERATE_MCP_LEAD_SERVICE_KEY: leadServiceKey,
  GENERATE_AGENT_AUTH_KEYS_JSON: keys,
  GENERATE_AGENT_AUTH_PUBLIC_KEYS_JSON: humanPublicKeys,
  GENERATE_LEAD_WRITER_AUTH_KEYS_JSON: leadPublicKeys,
  GENERATE_ACCEPTANCE_USER_PASSWORD: `Acceptance!${secret(18)}`,
  GENERATE_FASTGPT_ROOT_PASSWORD: `FastGPT!${secret(18)}`,
  GENERATE_FASTGPT_ROOT_KEY: secret(32),
  GENERATE_FASTGPT_TOKEN_KEY: secret(32),
  GENERATE_FASTGPT_FILE_TOKEN_KEY: secret(32),
  GENERATE_FASTGPT_AES_KEY: secret(32),
  GENERATE_FASTGPT_INVOKE_TOKEN_SECRET: secret(48),
  GENERATE_FASTGPT_MONGO_PASSWORD: secret(24),
  GENERATE_FASTGPT_REDIS_PASSWORD: secret(24),
  GENERATE_FASTGPT_MINIO_PASSWORD: secret(24),
  GENERATE_FASTGPT_PG_PASSWORD: secret(24),
  GENERATE_FASTGPT_PLUGIN_TOKEN: secret(32),
  GENERATE_FASTGPT_SANDBOX_TOKEN: secret(32),
  GENERATE_FASTGPT_AIPROXY_PG_PASSWORD: secret(24),
  GENERATE_FASTGPT_AIPROXY_API_TOKEN: secret(32),
};
let content = readFileSync(template, "utf8");
for (const [placeholder, value] of Object.entries(replacements)) content = content.replaceAll(placeholder, value);
const requestedToolMode = String(process.env.IDENTITY_ACCEPTANCE_TOOL_MODE || "").trim();
if (requestedToolMode) {
  if (!new Set(["IDENTITY_POC", "FULL_READ_ONLY"]).has(requestedToolMode)) {
    throw new Error("IDENTITY_ACCEPTANCE_TOOL_MODE must be IDENTITY_POC or FULL_READ_ONLY");
  }
  content = content.replace(/^MCP_TOOL_MODE=IDENTITY_POC$/m, `MCP_TOOL_MODE=${requestedToolMode}`);
  if (requestedToolMode === "FULL_READ_ONLY") {
    const allBusinessTools = [
      "lead_list", "lead_get", "lead_stats",
      "crm_customers_list", "crm_customer_get", "crm_customer_follows_list", "crm_products_list", "crm_product_get",
      "crm_contracts_list", "crm_contract_get", "crm_shipments_list", "crm_shipment_get", "erp_suppliers_list",
      "erp_supplier_get", "erp_purchase_orders_list", "erp_purchase_order_get", "erp_inventory_list",
      "erp_stock_documents_list", "erp_stock_movements_list", "erp_boms_list", "erp_bom_get",
      "erp_production_orders_list", "erp_production_order_get", "erp_kit_check",
    ].join(",");
    content = content.replace(/^MCP_TOOL_ALLOWLIST=$/m, `MCP_TOOL_ALLOWLIST=${allBusinessTools}`);
    content = content.replace(/^MCP_ALLOWED_CALLER_ROLES=$/m, "MCP_ALLOWED_CALLER_ROLES=SUPER_ADMIN,SALES,FOREIGN_TRADE,PURCHASE,WAREHOUSE");
  }
}
writeFileSync(output, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
const leadPrivateKeyOutput = resolve(output, "..", ".lead-service-private-jwk");
writeFileSync(leadPrivateKeyOutput, JSON.stringify(leadKeys.privateKey.export({ format: "jwk" })), {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
});
console.log(`Created isolated environment file: ${output}`);
