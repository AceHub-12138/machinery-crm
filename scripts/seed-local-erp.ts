import { PrismaClient } from "@prisma/client";
import "dotenv/config";

// 本地开发专用：插入演示 ERP 数据（仓库/物料/BOM/生产订单/齐套检查结果），
// 供齐套检查动效验收使用。安全护栏：仅允许 DATABASE_URL 指向 localhost 时运行。
const prisma = new PrismaClient();

const DEMO_MATERIALS = [
  { code: "DEMO-M-001", name: "主轴", spec: "BK5030-01", unit: "根", qty: 1, available: 5 },
  { code: "DEMO-M-002", name: "传动齿轮", spec: "BK5030-02", unit: "件", qty: 4, available: 6 },
  { code: "DEMO-M-003", name: "铸件床身", spec: "BK5030-00", unit: "件", qty: 1, available: 3 },
  { code: "DEMO-M-004", name: "主轴电机", spec: "Motor-7.5kW", unit: "台", qty: 2, available: 10 },
  { code: "DEMO-M-005", name: "轴承", spec: "7014C", unit: "套", qty: 8, available: 16 },
  { code: "DEMO-M-006", name: "钣金罩壳", spec: "BK5030-ZK", unit: "件", qty: 1, available: 1 },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl.includes("localhost") && !databaseUrl.includes("127.0.0.1")) {
    throw new Error("拒绝运行：此脚本只允许在 DATABASE_URL 指向 localhost 的本地库使用");
  }

  const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
  if (!admin) throw new Error("本地库没有管理员账号，请先执行 prisma/seed.ts");
  const product = await prisma.product.findFirst({ select: { id: true, model: true, category: true } });
  if (!product) throw new Error("本地库没有产品数据，请先执行 prisma/seed.ts");
  const productName =
    (await prisma.productTranslation.findFirst({ where: { productId: product.id, language: "ZH" }, select: { name: true } }))
      ?.name ?? product.model;

  // 仓库
  const warehouse = await prisma.warehouse.upsert({
    where: { code: "DEMO-WH-01" },
    update: {},
    create: { name: "演示一仓", code: "DEMO-WH-01" },
  });

  // 物料分类 + 物料
  let category = await prisma.materialCategory.findFirst({ where: { name: "演示机加件" } });
  if (!category) {
    category = await prisma.materialCategory.create({ data: { name: "演示机加件", code: "DEMO-JJ", warningThreshold: 5 } });
  }

  const materials: Record<string, string> = {};
  for (const demoMaterial of DEMO_MATERIALS) {
    const material = await prisma.material.upsert({
      where: { code: demoMaterial.code },
      update: {},
      create: {
        code: demoMaterial.code,
        name: demoMaterial.name,
        spec: demoMaterial.spec,
        unit: demoMaterial.unit,
        categoryId: category.id,
      },
    });
    materials[demoMaterial.code] = material.id;
  }

  // BOM
  let bom = await prisma.bomHeader.findFirst({ where: { productId: product.id, version: "v1.0" } });
  if (!bom) {
    bom = await prisma.bomHeader.create({ data: { productId: product.id, version: "v1.0" } });
    for (const demoMaterial of DEMO_MATERIALS) {
      await prisma.bomItem.create({
        data: { bomId: bom.id, materialId: materials[demoMaterial.code], quantity: demoMaterial.qty },
      });
    }
  }

  // 生产订单
  const contract = await prisma.contract.findFirst({ select: { id: true } });
  const orderQuantity = 2;
  let order = await prisma.productionOrder.findUnique({ where: { orderNo: "LOCAL-PO-001" } });
  if (!order) {
    order = await prisma.productionOrder.create({
      data: {
        orderNo: "LOCAL-PO-001",
        contractId: contract?.id ?? null,
        productId: product.id,
        productModelSnapshot: product.model,
        productNameSnapshot: productName,
        quantity: orderQuantity,
        bomId: bom.id,
        bomVersionSnapshot: "v1.0",
        warehouseId: warehouse.id,
        status: "ISSUED",
        createdById: admin.id,
      },
    });
  }

  // 齐套检查结果（缺料 2 项）
  const existingCheck = await prisma.kitCheckResult.findFirst({
    where: { productionOrderId: order.id, triggerKey: "local-demo-kit-001" },
  });
  if (!existingCheck) {
    const detail = DEMO_MATERIALS.map((demoMaterial) => {
      const totalRequiredQty = demoMaterial.qty * orderQuantity;
      const shortageQty = Math.max(0, totalRequiredQty - demoMaterial.available);
      return {
        materialId: materials[demoMaterial.code],
        code: demoMaterial.code,
        name: demoMaterial.name,
        spec: demoMaterial.spec,
        perUnitQty: demoMaterial.qty,
        orderQty: orderQuantity,
        totalRequiredQty,
        remainingRequiredQty: totalRequiredQty,
        availableQty: demoMaterial.available,
        shortageQty,
      };
    });
    const check = await prisma.kitCheckResult.create({
      data: {
        productionOrderId: order.id,
        warehouseId: warehouse.id,
        bomVersionSnapshot: "v1.0",
        status: "SHORTAGE",
        shortageCount: 2,
        totalMaterials: DEMO_MATERIALS.length,
        detail,
        checkedById: admin.id,
        triggerKey: "local-demo-kit-001",
        triggerType: "MANUAL",
      },
    });
    await prisma.productionOrder.update({
      where: { id: order.id },
      data: { kitCheckStatus: "SHORTAGE", kitCheckRequired: false, latestKitCheckId: check.id, lastKitCheckedAt: check.createdAt },
    });
  }

  console.log("本地 ERP 演示数据就绪：仓库 演示一仓 / 物料 6 种 / BOM v1.0 / 工单 LOCAL-PO-001 / 齐套结果（缺料 2 项）");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
