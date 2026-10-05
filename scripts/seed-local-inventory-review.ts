import { PrismaClient } from "@prisma/client";
import bcryptjs from "bcryptjs";
import "dotenv/config";

// 本地开发专用：为 ERP 工作台/库存审核铺设演示数据（按机型分仓 + 预警线各口径 + 出入库流水）。
// 安全护栏：仅允许 DATABASE_URL 指向 localhost 时运行；只新增/更新演示数据，不删除任何现有数据。
const prisma = new PrismaClient();

const REVIEW_EMAIL = "zcode-review@local.dev";
const REVIEW_PASSWORD = "ZcodeReview2026!";

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl.includes("localhost") && !databaseUrl.includes("127.0.0.1")) {
    throw new Error("拒绝运行：此脚本只允许在 DATABASE_URL 指向 localhost 的本地库使用");
  }

  // 临时审核超管（审核完成后可删除：DELETE FROM user WHERE email = 'zcode-review@local.dev'）
  const existingReviewer = await prisma.user.findUnique({ where: { email: REVIEW_EMAIL } });
  if (!existingReviewer) {
    await prisma.user.create({
      data: {
        email: REVIEW_EMAIL,
        password: await bcryptjs.hash(REVIEW_PASSWORD, 12),
        name: "本地审核员",
        role: "SUPER_ADMIN",
        region: "其他",
      },
    });
  }

  // 按机型分仓（对应线上真实仓型）
  const warehouses = {
    dc01: await prisma.warehouse.upsert({ where: { code: "DC01" }, update: { isActive: true }, create: { name: "BK5030成品件", code: "DC01" } }),
    dc03: await prisma.warehouse.upsert({ where: { code: "DC03" }, update: { isActive: true }, create: { name: "BK5030毛坯件", code: "DC03" } }),
    dz04: await prisma.warehouse.upsert({ where: { code: "DZ04" }, update: { isActive: true }, create: { name: "BK5035成品件", code: "DZ04" } }),
    dc02: await prisma.warehouse.upsert({ where: { code: "DC02" }, update: { isActive: true }, create: { name: "BK5030/35通用附件", code: "DC02" } }),
    dc06: await prisma.warehouse.upsert({ where: { code: "DC06" }, update: { isActive: true }, create: { name: "Y5132BCNC成品件", code: "DC06" } }),
  };

  // 物料分类（部分配分类预警线，通用附件留空验证"无阈值不预警"）
  const categories = {
    finished: await upsertCategory("成品件", "CP", 2),
    blank: await upsertCategory("毛坯件", "MP", 3),
    accessory: await upsertCategory("通用附件", "TY", null),
    electric: await upsertCategory("电气/电子件", "DQ", 10),
  };

  // 物料：覆盖预警口径的四种组合
  const materials = {
    // 仅分类预警线
    cp001: await upsertMaterial("BK5030-CP-001", "主轴箱总成", "BK5030-01", "台", categories.finished.id, null, false),
    cp002: await upsertMaterial("BK5030-CP-002", "床身部件", "BK5030-02", "台", categories.finished.id, null, false),
    cp003: await upsertMaterial("BK5030-CP-003", "溜板部件", "BK5030-03", "台", categories.finished.id, null, false),
    mp001: await upsertMaterial("BK5030-MP-001", "铸件床身毛坯", "BK5030-M1", "件", categories.blank.id, null, false),
    mp002: await upsertMaterial("BK5030-MP-002", "主轴毛坯", "BK5030-M2", "件", categories.blank.id, null, false),
    // 物料级安全库存（启用）
    tyfj001: await upsertMaterial("TY-FJ-001", "冷却水泵", "SB-370W", "台", categories.accessory.id, 4, true),
    tyfj002: await upsertMaterial("TY-FJ-002", "法兰盘", "FL-DN80", "件", categories.accessory.id, 10, true),
    // 物料级安全库存（启用）但库存充足
    dq001: await upsertMaterial("DQ-DJ-001", "伺服电机", "SVM-750W", "台", categories.electric.id, 5, true),
    // 填了安全库存但未启用 → 新口径回退分类预警线
    dq002: await upsertMaterial("DQ-DG-002", "电柜", "DG-BK5030", "台", categories.electric.id, 2, false),
  };

  // 库存行：正常 / 低于预警线 / 零库存
  const inventoryPlan: Array<{ warehouseId: string; materialId: string; quantity: number }> = [
    { warehouseId: warehouses.dc01.id, materialId: materials.cp001.id, quantity: 8 },
    { warehouseId: warehouses.dc01.id, materialId: materials.cp002.id, quantity: 2 },   // = 分类线2 → 预警
    { warehouseId: warehouses.dc01.id, materialId: materials.cp003.id, quantity: 0 },   // 零库存
    { warehouseId: warehouses.dc03.id, materialId: materials.mp001.id, quantity: 6 },
    { warehouseId: warehouses.dc03.id, materialId: materials.mp002.id, quantity: 1 },   // < 分类线3 → 预警
    { warehouseId: warehouses.dz04.id, materialId: materials.cp001.id, quantity: 4 },
    { warehouseId: warehouses.dz04.id, materialId: materials.cp002.id, quantity: 9 },
    { warehouseId: warehouses.dc02.id, materialId: materials.tyfj001.id, quantity: 6 },
    { warehouseId: warehouses.dc02.id, materialId: materials.tyfj002.id, quantity: 3 }, // < 物料线10 → 预警
    { warehouseId: warehouses.dc02.id, materialId: materials.dq001.id, quantity: 12 },
    { warehouseId: warehouses.dc02.id, materialId: materials.dq002.id, quantity: 8 },   // 未启用→分类线10 → 预警
  ];
  for (const row of inventoryPlan) {
    const totalAmount = row.quantity * 1000;
    await prisma.inventory.upsert({
      where: { warehouseId_materialId: { warehouseId: row.warehouseId, materialId: row.materialId } },
      update: { quantity: row.quantity, totalAmount },
      create: { warehouseId: row.warehouseId, materialId: row.materialId, quantity: row.quantity, totalAmount, avgPrice: 1000 },
    });
  }

  // 出入库流水（直接插 movements，供"最近出入库动态"展示）
  const reviewer = await prisma.user.findUnique({ where: { email: REVIEW_EMAIL }, select: { id: true } });
  const movementCount = await prisma.stockMovement.count({ where: { refType: "LOCAL_REVIEW" } });
  if (reviewer && movementCount === 0) {
    const movements: Array<{ warehouseId: string; materialId: string; type: "STOCK_IN" | "STOCK_OUT"; quantity: number; before: number; after: number; hoursAgo: number }> = [
      { warehouseId: warehouses.dc02.id, materialId: materials.tyfj001.id, type: "STOCK_IN", quantity: 6, before: 0, after: 6, hoursAgo: 2 },
      { warehouseId: warehouses.dc01.id, materialId: materials.cp001.id, type: "STOCK_OUT", quantity: 1, before: 9, after: 8, hoursAgo: 5 },
      { warehouseId: warehouses.dc02.id, materialId: materials.dq001.id, type: "STOCK_IN", quantity: 4, before: 8, after: 12, hoursAgo: 26 },
      { warehouseId: warehouses.dc03.id, materialId: materials.mp001.id, type: "STOCK_OUT", quantity: 2, before: 8, after: 6, hoursAgo: 30 },
      { warehouseId: warehouses.dz04.id, materialId: materials.cp002.id, type: "STOCK_IN", quantity: 3, before: 6, after: 9, hoursAgo: 50 },
      { warehouseId: warehouses.dc01.id, materialId: materials.cp003.id, type: "STOCK_OUT", quantity: 5, before: 5, after: 0, hoursAgo: 74 },
    ];
    for (const movement of movements) {
      await prisma.stockMovement.create({
        data: {
          warehouseId: movement.warehouseId,
          materialId: movement.materialId,
          type: movement.type,
          quantity: movement.quantity,
          beforeQty: movement.before,
          afterQty: movement.after,
          refType: "LOCAL_REVIEW",
          refId: "local-review",
          remark: "本地审核演示流水",
          createdById: reviewer.id,
          createdAt: new Date(Date.now() - movement.hoursAgo * 3600 * 1000),
        },
      });
    }
  }

  console.log("✅ 本地审核数据已就绪：5 仓库 / 9 物料 / 11 库存行 / 预警口径四组合 / 6 条流水");
  console.log(`✅ 审核账号：${REVIEW_EMAIL} / ${REVIEW_PASSWORD}`);
}

async function upsertCategory(name: string, code: string, warningThreshold: number | null) {
  const existing = await prisma.materialCategory.findFirst({ where: { name } });
  if (existing) return prisma.materialCategory.update({ where: { id: existing.id }, data: { warningThreshold } });
  return prisma.materialCategory.create({ data: { name, code, warningThreshold } });
}

async function upsertMaterial(code: string, name: string, spec: string, unit: string, categoryId: string, safetyStock: number | null, safetyStockEnabled: boolean) {
  return prisma.material.upsert({
    where: { code },
    update: { safetyStock, safetyStockEnabled },
    create: { code, name, spec, unit, categoryId, safetyStock, safetyStockEnabled, standardPrice: 1000 },
  });
}

main()
  .catch((error) => { console.error(error); process.exit(1); })
  .finally(() => prisma.$disconnect());
