import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const expectedDatabase = "dachuan_identity_acceptance";
const expectedHost = String(process.env.MCP_ACCEPTANCE_EXPECTED_DB_HOST || "mysql");
if (!new Set(["mysql", "127.0.0.1"]).has(expectedHost)) throw new Error("MCP acceptance database host is not allowlisted");
const accountScope = String(process.env.MCP_ACCEPTANCE_ACCOUNT_SCOPE || "FULL").toUpperCase();
const commandOnly = accountScope === "LEAD_WRITE_ONLY";
if (!commandOnly && accountScope !== "FULL") throw new Error("MCP_ACCEPTANCE_ACCOUNT_SCOPE must be FULL or LEAD_WRITE_ONLY");
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
const queryUrl = commandOnly ? null : new URL(process.env.MCP_QUERY_DATABASE_URL || "");
const auditUrl = commandOnly ? null : new URL(process.env.MCP_AUDIT_DATABASE_URL || "");
const commandUrl = new URL(process.env.MCP_COMMAND_DATABASE_URL || "");

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
requireIsolatedUrl(commandUrl, "MCP_COMMAND_DATABASE_URL");
const configuredUserNames = [queryUrl?.username, auditUrl?.username, commandUrl.username].filter(Boolean);
if (new Set(configuredUserNames).size !== configuredUserNames.length) {
  throw new Error("MCP query, audit and command users must differ");
}

const rootUrl = new URL(`mysql://root@${expectedHost}:3306/${expectedDatabase}`);
rootUrl.password = String(process.env.MYSQL_ROOT_PASSWORD || "");
if (!rootUrl.password) throw new Error("MYSQL_ROOT_PASSWORD is required");

const root = new PrismaClient({ datasources: { db: { url: rootUrl.toString() } } });
const query = queryUrl ? new PrismaClient({ datasources: { db: { url: queryUrl.toString() } } }) : null;
const audit = auditUrl ? new PrismaClient({ datasources: { db: { url: auditUrl.toString() } } }) : null;
const command = new PrismaClient({ datasources: { db: { url: commandUrl.toString() } } });

try {
  for (const url of [queryUrl, auditUrl, commandUrl].filter(Boolean)) {
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
  await root.$executeRawUnsafe(`GRANT SELECT, INSERT ON \`${expectedDatabase}\`.\`leads\` TO ${quoteSql(commandUrl.username)}@'%'`);
  // dedupKey UPDATE 仅用于把命中的旧版 company+phone+email 指纹惰性迁移为 company-only 指纹。
  await root.$executeRawUnsafe(`GRANT UPDATE (\`dedupKey\`, \`contactName\`, \`phone\`, \`email\`, \`sourceUrl\`, \`searchKeyword\`, \`aiScore\`, \`profile\`, \`sourceModelVersion\`, \`extractorVersion\`, \`updatedAt\`) ON \`${expectedDatabase}\`.\`leads\` TO ${quoteSql(commandUrl.username)}@'%'`);
  await root.$executeRawUnsafe(`GRANT SELECT, INSERT ON \`${expectedDatabase}\`.\`lead_write_idempotencies\` TO ${quoteSql(commandUrl.username)}@'%'`);
  await root.$executeRawUnsafe(`GRANT INSERT ON \`${expectedDatabase}\`.\`lead_write_audits\` TO ${quoteSql(commandUrl.username)}@'%'`);
  await root.$executeRawUnsafe(`GRANT SELECT (\`id\`, \`role\`, \`territories\`, \`isActive\`) ON \`${expectedDatabase}\`.\`users\` TO ${quoteSql(commandUrl.username)}@'%'`);
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

  await command.lead.findFirst({ select: { id: true } });
  await command.user.findMany({
    where: { isActive: true, role: { in: ["SALES", "FOREIGN_TRADE"] } },
    select: { id: true, role: true, territories: true, isActive: true },
  });
  await mustBeDenied(
    () => command.user.findFirst({ select: { email: true } }),
    "MCP command user unexpectedly read a non-routing User column",
  );
  await mustBeDenied(
    () => command.customer.findFirst({ select: { id: true } }),
    "MCP command user unexpectedly read the Customer domain",
  );
  await mustBeDenied(
    () => command.contract.findFirst({ select: { id: true } }),
    "MCP command user unexpectedly read the Contract domain",
  );
  const privilegeLeadId = randomUUID();
  const privilegeIdempotencyKey = `privilege-check-${randomUUID()}`;
  await command.lead.create({
    data: {
      id: privilegeLeadId,
      companyName: "Lead writer column grant check",
      source: "OTHER",
      idempotencyKey: privilegeIdempotencyKey,
      payloadHash: "0".repeat(64),
      dedupKey: `privilege-dedup-${randomUUID()}`,
    },
  });
  await command.lead.update({
    where: { id: privilegeLeadId },
    data: { searchKeyword: "allowed-column-update", aiScore: 1 },
  });
  await command.leadWriteIdempotency.create({
    data: { idempotencyKey: privilegeIdempotencyKey, payloadHash: "0".repeat(64), leadId: privilegeLeadId },
  });
  await command.leadWriteIdempotency.findUnique({ where: { idempotencyKey: privilegeIdempotencyKey } });
  await command.$executeRaw`
    INSERT INTO lead_write_audits
      (id, principalType, principalId, action, entityType, idempotencyKey, outcome, payloadHash, requestId, createdAt)
    VALUES
      (${randomUUID()}, ${"SERVICE"}, ${"acceptance-provisioner"}, ${"PRIVILEGE_CHECK"}, ${"Lead"}, ${`privilege-check-${randomUUID()}`}, ${"REPLAY"}, ${"0".repeat(64)}, ${`privilege-check-${randomUUID()}`}, UTC_TIMESTAMP(3))
  `;
  await mustBeDenied(
    () => command.$executeRaw`INSERT INTO lead_feedback_events (id, leadId) VALUES (${randomUUID()}, ${"forbidden-lead-id"})`,
    "MCP command user unexpectedly inserted into lead_feedback_events",
  );
  await mustBeDenied(
    () => command.lead.updateMany({ data: { companyName: "forbidden-update" } }),
    "MCP command user unexpectedly updated a protected Lead column",
  );
  await mustBeDenied(
    () => command.lead.updateMany({ data: { assignedUserId: "forbidden-assignment" } }),
    "MCP command user unexpectedly updated Lead sales assignment",
  );
  await mustBeDenied(
    () => command.lead.updateMany({ data: { externalLeadId: "forbidden-source-overwrite" } }),
    "MCP command user unexpectedly updated preserved Lead source identity",
  );
  await mustBeDenied(
    () => command.lead.deleteMany({}),
    "MCP command user unexpectedly deleted leads",
  );
  console.log("MCP_ACCEPTANCE_LEAD_WRITER_PRIVILEGES=PASS");
} finally {
  await Promise.all([root.$disconnect(), query?.$disconnect(), audit?.$disconnect(), command.$disconnect()]);
}
