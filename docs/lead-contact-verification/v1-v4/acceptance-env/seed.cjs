// 仅由启动脚本在全新的一次性容器中调用。
const { PrismaClient } = require("/app/node_modules/@prisma/client");
const bcrypt = require("/app/node_modules/bcryptjs");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const db = new PrismaClient();
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (url.hostname !== "127.0.0.1" || url.port !== "3306" || url.pathname !== "/crm_acceptance") throw Error("测试库地址不符");
  const accounts = JSON.parse(fs.readFileSync(0, "utf8"));
  if (await db.user.count() || await db.customer.count()) throw Error("测试库须为空");
  const names = ["ADMIN", "SALES_NORTH", "SALES_SOUTH", "FOREIGN_TRADE", "SALES_EAST"];
  const env = { ...process.env, ALLOW_DESTRUCTIVE_SEED: "local-development-only",
    SEED_ADMIN_PASSWORD: accounts[0].password, SEED_SALES_PASSWORD: accounts[1].password };
  names.forEach((name, i) => { env["SEED_" + name + "_EMAIL"] = accounts[i].email; });
  if (spawnSync("node_modules/.bin/tsx", ["prisma/seed.ts"], { env, stdio: "ignore" }).status !== 0) throw Error("seed 失败");
  const regions = ["", "北京", "广东", "上海", "江苏"];
  const users = [];
  for (const [i, account] of accounts.entries()) {
    users.push(await db.user.update({ where: { email: account.email }, data: {
      name: account.role, password: await bcrypt.hash(account.password, 12),
      territories: i ? [{ province: regions[i], cities: [] }] : [],
    } }));
  }
  for (const [i, customer] of (await db.customer.findMany({ orderBy: { companyName: "asc" } })).entries()) {
    const owner = users.findIndex(u => u.id === customer.assignedUserId);
    await db.customer.update({ where: { id: customer.id }, data: {
      companyName: accounts[owner].role + "验收测试机械" + (i + 1) + "有限公司",
      phone: "0000-0000000" + i, email: "fixture" + i + "@example.invalid", wechat: null, whatsapp: null,
      province: regions[owner], city: regions[owner], businessLine: owner === 3 ? "外贸" : "国内销售",
    } });
  }
  const customer = await db.customer.findFirstOrThrow({ where: { assignedUserId: users[1].id } });
  const product = await db.product.findFirstOrThrow({ where: { model: "BK5030" } });
  await db.contract.create({ data: { id: "accept-contract", contractNo: "YS-001", signedDate: new Date(),
    customerId: customer.id, salesUserId: users[1].id, createdById: users[0].id, productId: product.id,
    equipmentName: "验收测试插床", equipmentModel: product.model, amount: 100, unpaidAmount: 100,
    items: { create: { productId: product.id, productNameSnapshot: "验收测试插床", productModelSnapshot: product.model,
      contractPrice: 100, quantity: 1, itemType: "MAIN" } } } });
  async function lead(id, label, status, assignedUserId = null) {
    return db.lead.create({ data: { id, companyName: "验收测试" + label + "机械有限公司",
      source: "MANUAL", sourceUrl: "https://example.com/acceptance-source", aiScore: 88, contactStatus: status, assignedUserId } });
  }
  for (const [id, label] of [["mock-single","模拟单查"],["quota-single","额度单查"],["quota-a","额度批查甲"],["quota-b","额度批查乙"],["offline","未配置单查"],["offline-a","未配置批查甲"],["offline-b","未配置批查乙"]]) await lead(id,label,"PENDING_LOOKUP");
  for (const [i, id] of [[1,"north"],[2,"south"],[3,"trade"]]) await lead(id, accounts[i].role,"PENDING_LOOKUP",users[i].id);
  for (const [id, label, name] of [["no-name","缺名",null],["compare","对照","验收测试乙设备有限公司"]]) {
    const row = await lead(id,label,"NEEDS_CONFIRM");
    await db.leadContactLookup.create({ data: { leadId: id, requestedById: users[0].id, queryName: row.companyName,
      queryNameNormalized: row.companyName, status: "NEEDS_CONFIRM", matchedName: name, regStatus: "存续",
      phones: ["0000-00000088"], emails: ["fixture@example.invalid"], creditCode: "TEST00000000000088",
      reason: "验收预置人工复核样本", rawResponse: { historyNames: ["验收测试乙厂"], regLocation: "验收测试路88号" } } });
  }
  await db.leadHuntTask.create({ data: { id: "candidate-task", status: "done", createdById: users[0].id,
    config: { goal: "验收测试：85分候选", maxRounds: 1, pagesPerRound: 1, keywordIterations: 1 },
    candidates: { create: { companyName: "验收测试候选机械有限公司", status: "NO_CONTACT",
      score: 85, round: 1, contactName: "验收联系人甲", sourceUrl: "https://example.com/acceptance-source" } } } });
  const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0,10);
  await db.leadLookupDailyQuota.create({ data: { quotaDate: date, used: 1 } });
}
main().catch(() => { process.exitCode = 1; }).finally(() => db.$disconnect());
