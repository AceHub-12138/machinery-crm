import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const expectedDatabase = "dachuan_identity_acceptance";
const expectedHost = String(process.env.MCP_ACCEPTANCE_EXPECTED_DB_HOST || "mysql");
if (!new Set(["mysql", "127.0.0.1"]).has(expectedHost)) throw new Error("MCP acceptance database host is not allowlisted");
const queryTables = [
  "users",
  "customers",
  "contracts",
  "customer_quotes",
  "follow_records",
  "products",
  "product_translations",
  "contract_items",
  "contract_payments",
  "shipments",
  "leads",
  "lead_feedback_events",
  "erp_inventories",
  "erp_materials",
  "erp_warehouses",
  "erp_material_categories",
  "erp_suppliers",
  "erp_purchase_orders",
  "erp_purchase_order_items",
  "erp_stock_ins",
  "erp_stock_in_items",
  "erp_stock_outs",
  "erp_stock_out_items",
  "erp_stock_movements",
  "erp_bom_headers",
  "erp_bom_items",
  "erp_production_orders",
  "erp_production_order_materials",
  "erp_production_order_change_requests",
  "erp_kit_check_results",
];
const queryUrl = new URL(process.env.MCP_QUERY_DATABASE_URL || "");
const auditUrl = new URL(process.env.MCP_AUDIT_DATABASE_URL || "");

function requireIsolatedUrl(url, name) {
  if (
    url.protocol !== "mysql:"
    || url.hostname !== expectedHost
    || url.port !== "3306"
    || url.pathname !== `/${expectedDatabase}`
    || !/^[a-z][a-z0-9_]*$/.test(url.username)
  ) {
    throw new Error(`${name} must target the fixed isolated MySQL database`);
  }
}

function quoteSql(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function mustBeDenied(action, message) {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(message);
}

if (queryUrl) requireIsolatedUrl(queryUrl, "MCP_QUERY_DATABASE_URL");
if (auditUrl) requireIsolatedUrl(auditUrl, "MCP_AUDIT_DATABASE_URL");
const configuredUserNames = [queryUrl?.username, auditUrl?.username].filter(Boolean);
if (new Set(configuredUserNames).size !== configuredUserNames.length) {
  throw new Error("MCP query, audit and command users must differ");
}

const rootUrl = new URL(`mysql://root@${expectedHost}:3306/${expectedDatabase}`);
rootUrl.password = String(process.env.MYSQL_ROOT_PASSWORD || "");
if (!rootUrl.password) throw new Error("MYSQL_ROOT_PASSWORD is required");

const root = new PrismaClient({ datasources: { db: { url: rootUrl.toString() } } });
const query = queryUrl ? new PrismaClient({ datasources: { db: { url: queryUrl.toString() } } }) : null;
const audit = auditUrl ? new PrismaClient({ datasources: { db: { url: auditUrl.toString() } } }) : null;

try {
  for (const url of [queryUrl, auditUrl].filter(Boolean)) {
    await root.$executeRawUnsafe(`DROP USER IF EXISTS ${quoteSql(url.username)}@'%'`);
    await root.$executeRawUnsafe(`CREATE USER ${quoteSql(url.username)}@'%' IDENTIFIED BY ${quoteSql(decodeURIComponent(url.password))}`);
  }
  if (queryUrl) {
    for (const table of queryTables) {
      await root.$executeRawUnsafe(`GRANT SELECT ON \`${expectedDatabase}\`.\`${table}\` TO ${quoteSql(queryUrl.username)}@'%'`);
    }
  }
  if (auditUrl) {
    await root.$executeRawUnsafe(`GRANT INSERT ON \`${expectedDatabase}\`.\`operation_logs\` TO ${quoteSql(auditUrl.username)}@'%'`);
  }
  await root.$executeRawUnsafe("FLUSH PRIVILEGES");

  if (query && audit) {
    const auditUserId = String(process.env.MCP_AUDIT_USER_ID || "");
    if (!auditUserId) throw new Error("MCP_AUDIT_USER_ID is required");
    const auditUser = await query.user.findUnique({ where: { id: auditUserId }, select: { id: true } });
    if (!auditUser) throw new Error("The isolated audit user was not seeded");

    await audit.$executeRaw`
      INSERT INTO operation_logs (id, userId, action, entityType, entityId, afterData)
      VALUES (${randomUUID()}, ${auditUser.id}, ${"MCP_ACCEPTANCE_PRIVILEGE_CHECK"}, ${"McpAcceptance"}, ${"dual-account-grant-check"}, ${JSON.stringify({ source: "isolated-acceptance" })})
    `;
    await mustBeDenied(
      () => query.$executeRaw`
        INSERT INTO operation_logs (id, userId, action, entityType, entityId)
        VALUES (${randomUUID()}, ${auditUser.id}, ${"MCP_ACCEPTANCE_DENIED_WRITE"}, ${"McpAcceptance"}, ${"query-user-must-not-insert"})
      `,
      "MCP query user unexpectedly inserted an audit record",
    );
    await mustBeDenied(
      () => audit.user.findFirst({ select: { id: true } }),
      "MCP audit user unexpectedly read a business table",
    );
    await mustBeDenied(
      () => query.auditLog.findFirst({ select: { id: true } }),
      "MCP query user unexpectedly read an unapproved business table",
    );
    console.log("MCP_ACCEPTANCE_DUAL_DATABASE_PRIVILEGES=PASS");
  }

} finally {
  await Promise.all([root.$disconnect(), query?.$disconnect(), audit?.$disconnect()]);
}
