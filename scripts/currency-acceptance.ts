/** 仅隔离本地 MySQL 验收库；不运行 seed、不删除业务数据、不迁移项目结构。
 * DATABASE_URL=mysql://root@127.0.0.1:13376/currency_test pnpm exec tsx scripts/currency-acceptance.ts
 * 输出目录用 CURRENCY_EVIDENCE_DIR 指定。验收后可停止并移除临时容器。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";
import { getCrmDashboard } from "../src/modules/crm/dashboard/service";
import { getActualAmount } from "../src/modules/crm/sales-targets/service";
import { getPublicSalesScreenPayload } from "../src/modules/screen/public-service";
import { DEFAULT_SALES_SCREEN_CONFIG } from "../src/modules/screen/config";
import type { SessionUser } from "../src/lib/permissions";

async function main() {
  const url = new URL(process.env.DATABASE_URL || "http://invalid");
  assert.equal(url.protocol, "mysql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "13376");
  assert.equal(url.pathname, "/currency_test", "禁止连接业务数据库");
  const output = resolve(process.env.CURRENCY_EVIDENCE_DIR || "/tmp/currency-evidence");
  mkdirSync(output, { recursive: true });
  const at = new Date("2026-10-13T04:00:00.000Z");
  const prefix = "currency-acceptance-";
  const userRow = await prisma.user.upsert({ where: { id: `${prefix}admin` }, update: {}, create: {
    id: `${prefix}admin`, email: "currency-acceptance@example.invalid", name: "币种本地验收", password: await bcrypt.hash("LocalCurrencyTest2026!", 10), role: "SUPER_ADMIN", viewScope: "ALL",
  } });
  const customer = await prisma.customer.upsert({ where: { id: `${prefix}customer` }, update: {}, create: {
    id: `${prefix}customer`, companyName: "隔离验收客户", contactName: "验收员", province: "山东省", city: "济南市", customerSource: "其他", customerType: "NEW", customerLevel: "B", assignedUserId: userRow.id, createdAt: at,
  } });
  const product = await prisma.product.upsert({ where: { id: `${prefix}product` }, update: {}, create: {
    id: `${prefix}product`, model: "BK5030-CURRENCY-TEST", category: "数控插床", currency: "CNY", factoryPrice: 50000,
  } });
  const values = [[50000, 20000, "CNY"], [60000, 30000, "CNY"], [75500, 25000, "CNY"], [25600, 5600, "EUR"]] as const;
  for (const [index, [amount, paidAmount, currency]] of values.entries()) {
    const id = `${prefix}contract-${index + 1}`;
    await prisma.contract.upsert({ where: { id }, update: { deletedAt: null }, create: {
      id, contractNo: `CURRENCY-TEST-${index + 1}`, signedDate: at, createdAt: at, customerId: customer.id, salesUserId: userRow.id, createdById: userRow.id, productId: product.id, equipmentName: "数控插床", equipmentModel: product.model, amount, paidAmount, unpaidAmount: amount - paidAmount, currency, paymentStatus: "PARTIAL_PAID", contractStatus: "SIGNED",
      items: { create: { productId: product.id, itemType: "MAIN", productNameSnapshot: "数控插床", productModelSnapshot: product.model, factoryPriceSnapshot: 50000, contractPrice: amount, quantity: 1 } },
      payments: { create: { amount: paidAmount, paymentDate: at, createdById: userRow.id } },
    } });
  }
  const publicId = "c".repeat(43);
  await prisma.systemSetting.upsert({ where: { key: "salesScreen" }, update: {}, create: { key: "salesScreen", value: { ...DEFAULT_SALES_SCREEN_CONFIG, enabled: true } } });
  await prisma.systemSetting.upsert({ where: { key: "salesScreenShare" }, update: {}, create: { key: "salesScreenShare", value: { version: 1, publicId, createdAt: at.toISOString(), rotatedAt: null, revokedAt: null } } });
  const user: SessionUser = { id: userRow.id, name: userRow.name, role: "SUPER_ADMIN", region: "", territories: [], viewScope: "ALL" };
  const query = new URLSearchParams({ preset: "month" });
  const mixed = await getCrmDashboard(user, query, at);
  assert.deepEqual(mixed.stats.amountsByCurrency.periodContractAmount, [{ currency: "CNY", amount: "185500.00" }, { currency: "EUR", amount: "25600.00" }]);
  assert.deepEqual(mixed.stats.amountsByCurrency.totalPaidAmount, [{ currency: "CNY", amount: "75000.00" }, { currency: "EUR", amount: "5600.00" }]);
  assert.deepEqual(mixed.stats.amountsByCurrency.totalUnpaidAmount, [{ currency: "CNY", amount: "110500.00" }, { currency: "EUR", amount: "20000.00" }]);
  for (const field of ["periodContractAmount", "totalContractAmount"] as const) assert.equal(String(mixed.stats[field]), "185500");
  for (const field of ["periodPaidAmount", "totalPaidAmount"] as const) assert.equal(String(mixed.stats[field]), "75000");
  for (const field of ["periodUnpaidAmount", "totalUnpaidAmount"] as const) assert.equal(String(mixed.stats[field]), "110500");
  const actual = await getActualAmount(user, { periodType: "MONTH", periodYear: 2026, periodIndex: 10, start: new Date(2026, 9, 1), end: new Date(2026, 10, 1), label: "2026年10月" }, "CONTRACT_AMOUNT", null);
  assert.equal(actual.toFixed(2), "185500.00");
  const sql = await prisma.$queryRaw<Array<{ currency: string; total: { toFixed(n: number): string } }>>`SELECT currency, SUM(amount) AS total FROM contracts WHERE deletedAt IS NULL GROUP BY currency ORDER BY currency`;
  assert.deepEqual(sql.map(row => ({ currency: row.currency, amount: row.total.toFixed(2) })), mixed.stats.amountsByCurrency.totalContractAmount);
  writeFileSync(resolve(output, "mixed-dashboard.json"), JSON.stringify(mixed, null, 2));
  writeFileSync(resolve(output, "database-totals.json"), JSON.stringify(sql, null, 2));
  // 原基线公开大屏代码及所有依赖均未改变；再用同一数据库/时钟比较完整 payload。
  execFileSync("git", ["diff", "--exit-code", "f2ce4dd", "--", "prisma/schema.prisma", "prisma/migrations", "src/modules/screen", "src/components/screen", "src/app/api/screen", "src/app/screen"]);
  const baselineSource = execFileSync("git", ["show", "f2ce4dd:src/modules/screen/public-service.ts"], { encoding: "utf8" });
  const compiled = ts.transpileModule(baselineSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const baselineModule = { exports: {} as { getPublicSalesScreenPayload: typeof getPublicSalesScreenPayload } };
  new Function("require", "exports", "module", compiled)(createRequire(resolve("src/modules/screen/public-service.ts")), baselineModule.exports, baselineModule);
  const before = await baselineModule.exports.getPublicSalesScreenPayload(publicId, { now: () => at });
  const after = await getPublicSalesScreenPayload(publicId, { now: () => at });
  assert.deepEqual(after, before);
  writeFileSync(resolve(output, "screen-baseline.json"), JSON.stringify(before, null, 2));
  writeFileSync(resolve(output, "screen-current.json"), JSON.stringify(after, null, 2));
  const sha = createHash("sha256").update(JSON.stringify(after)).digest("hex");
  await prisma.contract.update({ where: { id: `${prefix}contract-4` }, data: { deletedAt: at } });
  const cny = await getCrmDashboard(user, query, at);
  assert.deepEqual(cny.stats.amountsByCurrency.periodContractAmount, [{ currency: "CNY", amount: "185500.00" }]);
  writeFileSync(resolve(output, "cny-dashboard.json"), JSON.stringify(cny, null, 2));
  await prisma.contract.update({ where: { id: `${prefix}contract-4` }, data: { deletedAt: null } });
  console.log(JSON.stringify({ result: "PASS", mysql: "isolated-local", cny: "185500.00", eur: "25600.00", targetCny: actual.toFixed(2), screenPayloadIdentical: true, screenSha256: sha, output }, null, 2));
}
main().finally(() => prisma.$disconnect());
