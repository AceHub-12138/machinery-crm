import { PrismaClient } from "@prisma/client";
import bcryptjs from "bcryptjs";
import "dotenv/config";

const prisma = new PrismaClient();

function requireSeedValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required seed environment variable: ${name}`);
  return value;
}

async function main() {
  if (process.env.ALLOW_DESTRUCTIVE_SEED !== "local-development-only") {
    throw new Error("Refusing destructive seed without ALLOW_DESTRUCTIVE_SEED=local-development-only");
  }

  const adminEmail = requireSeedValue("SEED_ADMIN_EMAIL");
  const salesNorthEmail = requireSeedValue("SEED_SALES_NORTH_EMAIL");
  const salesSouthEmail = requireSeedValue("SEED_SALES_SOUTH_EMAIL");
  const salesEastEmail = requireSeedValue("SEED_SALES_EAST_EMAIL");
  const foreignTradeEmail = requireSeedValue("SEED_FOREIGN_TRADE_EMAIL");
  const adminPassword = requireSeedValue("SEED_ADMIN_PASSWORD");
  const salesPasswordPlain = requireSeedValue("SEED_SALES_PASSWORD");
  if (adminPassword.length < 12 || salesPasswordPlain.length < 12) {
    throw new Error("Seed passwords must contain at least 12 characters");
  }

  console.log("🌱 开始初始化种子数据...");

  // 清空现有数据
  await prisma.contractPayment.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.customerQuote.deleteMany();
  await prisma.followRecord.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.productTranslation.deleteMany();
  await prisma.product.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();

  // ==================== 创建用户 ====================
  const hashedPassword = await bcryptjs.hash(adminPassword, 12);
  const salesPassword = await bcryptjs.hash(salesPasswordPlain, 12);

  const admin = await prisma.user.create({
    data: { email: adminEmail, password: hashedPassword, name: "系统管理员", role: "SUPER_ADMIN", region: "其他" },
  });
  const salesNorth = await prisma.user.create({
    data: { email: salesNorthEmail, password: salesPassword, name: "张华北", role: "SALES", region: "华北" },
  });
  const salesSouth = await prisma.user.create({
    data: { email: salesSouthEmail, password: salesPassword, name: "李华南", role: "SALES", region: "华南" },
  });
  const salesEast = await prisma.user.create({
    data: { email: salesEastEmail, password: salesPassword, name: "王华东", role: "SALES", region: "华东" },
  });
  const foreignTrade = await prisma.user.create({
    data: { email: foreignTradeEmail, password: salesPassword, name: "赵外贸", role: "FOREIGN_TRADE", region: "外贸" },
  });
  console.log("✅ 用户创建完成");

  // ==================== 创建产品（含出厂价） ====================
  const product1 = await prisma.product.create({
    data: {
      model: "BK5030", category: "数控插床", factoryPrice: 100000, currency: "CNY",
      translations: { create: [
        { language: "ZH", name: "BK5030 数控插床", description: "高精度数控金属切削设备", specs: { "最大插削长度": "300mm", "工作台直径": "400mm", "主电机功率": "3kW" } },
        { language: "EN", name: "BK5030 CNC Slotting Machine", description: "High-precision CNC metal cutting equipment", specs: { "Max Slotting Length": "300mm", "Main Motor Power": "3kW" } },
      ]},
    },
  });
  const product2 = await prisma.product.create({
    data: {
      model: "BK5035", category: "数控插床", factoryPrice: 130000, currency: "CNY",
      translations: { create: [
        { language: "ZH", name: "BK5035 数控插床", description: "BK5030升级版，更大加工行程", specs: { "最大插削长度": "350mm", "工作台直径": "500mm", "主电机功率": "4kW" } },
      ]},
    },
  });
  const product3 = await prisma.product.create({
    data: {
      model: "YK5150", category: "数控插齿机", factoryPrice: 180000, currency: "CNY",
      translations: { create: [
        { language: "ZH", name: "YK5150 数控插齿机", description: "可加工各种直齿、斜齿圆柱齿轮", specs: { "最大加工模数": "5", "最大加工直径": "500mm" } },
      ]},
    },
  });
  const product4 = await prisma.product.create({
    data: {
      model: "BC6063", category: "刨床", factoryPrice: 80000, currency: "CNY",
      translations: { create: [
        { language: "ZH", name: "BC6063 牛头刨床", description: "通用型金属切削机床", specs: { "最大刨削长度": "630mm", "主电机功率": "5.5kW" } },
      ]},
    },
  });
  console.log("✅ 产品创建完成（含出厂价格）");

  // ==================== 创建客户 ====================
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const threeDaysLater = new Date(today); threeDaysLater.setDate(threeDaysLater.getDate() + 3);

  const customerNorth = await prisma.customer.create({
    data: { companyName: "北京精密机械有限公司", contactName: "刘经理", phone: "13800138001", wechat: "liu_jingmi", email: "liu@bjjm.com", province: "北京", city: "北京", region: "华北", customerSource: "展会", customerType: "END_USER", customerLevel: "A", status: "WON", interestTags: ["数控插床", "高意向"], assignedUserId: salesNorth.id, nextFollowDate: tomorrow, lastFollowDate: yesterday },
  });
  const customerNorth2 = await prisma.customer.create({
    data: { companyName: "天津重工集团", contactName: "王总", phone: "13800138002", province: "天津", city: "天津", region: "华北", customerSource: "老客户介绍", customerType: "OLD", customerLevel: "B", status: "NEGOTIATING", interestTags: ["数控插齿机", "刨床"], assignedUserId: salesNorth.id, nextFollowDate: yesterday },
  });
  const customerSouth = await prisma.customer.create({
    data: { companyName: "广州数控设备有限公司", contactName: "陈总监", phone: "13900139001", email: "chen@gzsk.com", province: "广东", city: "广州", region: "华南", customerSource: "阿里巴巴", customerType: "AGENT", customerLevel: "A", status: "CONTACTED", interestTags: ["数控插床", "代理商"], assignedUserId: salesSouth.id, nextFollowDate: threeDaysLater },
  });
  const customerSouth2 = await prisma.customer.create({
    data: { companyName: "深圳精工科技", contactName: "黄工", phone: "13900139002", province: "广东", city: "深圳", region: "华南", customerSource: "官网", customerType: "NEW", customerLevel: "C", status: "NEW_LEAD", interestTags: ["自动化设备"], assignedUserId: salesSouth.id, nextFollowDate: today },
  });
  const customerEast = await prisma.customer.create({
    data: { companyName: "上海联合机械制造", contactName: "张副总", phone: "13700137001", email: "zhang@shlh.com", province: "上海", city: "上海", region: "华东", customerSource: "展会", customerType: "END_USER", customerLevel: "A", status: "WON", interestTags: ["数控插床", "数控插齿机"], assignedUserId: salesEast.id, nextFollowDate: tomorrow },
  });
  const customerEast2 = await prisma.customer.create({
    data: { companyName: "江苏恒力齿轮", contactName: "李采购", phone: "13700137002", province: "江苏", city: "南京", region: "华东", customerSource: "电话开发", customerType: "NEW", customerLevel: "B", status: "CONTACTED", interestTags: ["数控插齿机"], assignedUserId: salesEast.id, nextFollowDate: threeDaysLater },
  });
  const customerForeign = await prisma.customer.create({
    data: { companyName: "ABC Machinery Co., Ltd", contactName: "John Smith", phone: "+1-555-0123", whatsapp: "+1-555-0123", email: "john@abcmachinery.com", country: "美国", region: "外贸", customerSource: "外贸询盘", customerType: "DISTRIBUTOR", customerLevel: "A", status: "QUOTED", interestTags: ["数控插床", "外贸客户"], assignedUserId: foreignTrade.id, nextFollowDate: tomorrow },
  });
  const customerForeign2 = await prisma.customer.create({
    data: { companyName: "Maquinaria Industrial S.A.", contactName: "Carlos García", whatsapp: "+34-600-123456", email: "carlos@maquinaria.es", country: "西班牙", region: "外贸", customerSource: "阿里巴巴", customerType: "AGENT", customerLevel: "B", status: "CONTACTED", interestTags: ["刨床", "外贸客户"], assignedUserId: foreignTrade.id, nextFollowDate: yesterday },
  });
  console.log("✅ 客户创建完成");

  // ==================== 创建跟进记录 ====================
  await prisma.followRecord.createMany({
    data: [
      { customerId: customerNorth.id, userId: salesNorth.id, followType: "VISIT", content: "到厂拜访刘经理，客户对BK5030非常感兴趣", result: "要求提供报价单", nextFollowDate: tomorrow, newStatus: "QUOTED", createdAt: new Date(today.getTime() - 2 * 86400000) },
      { customerId: customerNorth.id, userId: salesNorth.id, followType: "PHONE", content: "电话确认报价，客户同意签订合同", result: "已签订合同", nextFollowDate: tomorrow, createdAt: yesterday },
      { customerId: customerSouth.id, userId: salesSouth.id, followType: "WECHAT", content: "微信沟通代理合作方案", result: "约定视频会议", nextFollowDate: threeDaysLater, createdAt: yesterday },
      { customerId: customerEast.id, userId: salesEast.id, followType: "EXHIBITION", content: "上海工博会认识张副总", result: "约定展会后参观", nextFollowDate: tomorrow, newStatus: "NEGOTIATING", createdAt: new Date(today.getTime() - 7 * 86400000) },
      { customerId: customerForeign.id, userId: foreignTrade.id, followType: "EMAIL", content: "Sent quotation for BK5030", result: "Customer requested FOB price", nextFollowDate: tomorrow, newStatus: "QUOTED", createdAt: new Date(today.getTime() - 3 * 86400000) },
    ],
  });
  console.log("✅ 跟进记录创建完成");

  // ==================== 创建客户报价 ====================
  await prisma.customerQuote.create({
    data: { customerId: customerNorth.id, productId: product1.id, quotedPrice: 120000, factoryPriceSnapshot: 100000, currency: "CNY", remark: "含安装调试", createdById: salesNorth.id },
  });
  await prisma.customerQuote.create({
    data: { customerId: customerEast.id, productId: product2.id, quotedPrice: 155000, factoryPriceSnapshot: 130000, currency: "CNY", remark: "批量采购优惠价", createdById: salesEast.id },
  });
  await prisma.customerQuote.create({
    data: { customerId: customerEast.id, productId: product3.id, quotedPrice: 210000, factoryPriceSnapshot: 180000, currency: "CNY", remark: "含一年质保", createdById: salesEast.id },
  });
  console.log("✅ 客户报价创建完成");

  // ==================== 创建合同 ====================
  // 合同1：已签订已全款（北京精密）
  const contract1 = await prisma.contract.create({
    data: {
      contractNo: "HT-2026-001", signedDate: new Date(today.getTime() - 30 * 86400000),
      customerId: customerNorth.id, salesUserId: salesNorth.id, productId: product1.id,
      equipmentName: "BK5030 数控插床", equipmentModel: "BK5030",
      amount: 120000, paidAmount: 120000, unpaidAmount: 0,
      paymentStatus: "PAID", contractStatus: "SIGNED", createdById: admin.id,
    },
  });
  // 合同2：部分打款（上海联合）
  const contract2 = await prisma.contract.create({
    data: {
      contractNo: "HT-2026-002", signedDate: new Date(today.getTime() - 15 * 86400000),
      customerId: customerEast.id, salesUserId: salesEast.id, productId: product2.id,
      equipmentName: "BK5035 数控插床", equipmentModel: "BK5035",
      amount: 155000, paidAmount: 50000, unpaidAmount: 105000,
      paymentStatus: "PARTIAL_PAID", contractStatus: "SIGNED", createdById: admin.id,
    },
  });
  // 合同3：已签订未打款（天津重工）
  const contract3 = await prisma.contract.create({
    data: {
      contractNo: "HT-2026-003", signedDate: new Date(today.getTime() - 5 * 86400000),
      customerId: customerNorth2.id, salesUserId: salesNorth.id, productId: product3.id,
      equipmentName: "YK5150 数控插齿机", equipmentModel: "YK5150",
      amount: 210000, paidAmount: 0, unpaidAmount: 210000,
      paymentStatus: "UNPAID", contractStatus: "SIGNED", createdById: admin.id,
    },
  });
  console.log("✅ 合同创建完成");

  // ==================== 创建回款记录 ====================
  // 合同1全款
  await prisma.contractPayment.create({
    data: { contractId: contract1.id, amount: 120000, paymentDate: new Date(today.getTime() - 25 * 86400000), paymentMethod: "银行转账", remark: "全款到账", createdById: admin.id },
  });
  // 合同2部分打款
  await prisma.contractPayment.create({
    data: { contractId: contract2.id, amount: 50000, paymentDate: new Date(today.getTime() - 10 * 86400000), paymentMethod: "银行转账", remark: "首付款30%", createdById: salesEast.id },
  });
  console.log("✅ 回款记录创建完成");

  console.log("");
  console.log("========================================");
  console.log("🎉 种子数据初始化完成！（含第二阶段数据）");
  console.log("========================================");
  console.log("");
  console.log("📋 种子账号已按环境变量创建，凭据不会输出。");
  console.log("");
  console.log("📊 合同数据：");
  console.log("  HT-2026-001: 已全款 ¥120,000（北京精密）");
  console.log("  HT-2026-002: 部分打款 ¥50,000/¥155,000（上海联合）");
  console.log("  HT-2026-003: 未打款 ¥210,000（天津重工）");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
