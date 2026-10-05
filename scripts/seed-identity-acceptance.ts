import bcryptjs from "bcryptjs";
import { PrismaClient, type Role } from "@prisma/client";

const databaseUrl = new URL(process.env.DATABASE_URL || "");
if (
  process.env.IDENTITY_ACCEPTANCE_ENV !== "isolated"
  || process.env.COMPOSE_PROJECT_NAME !== "dachuan-identity-acceptance"
  || databaseUrl.hostname !== "mysql"
  || databaseUrl.pathname !== "/dachuan_identity_acceptance"
) {
  throw new Error("Refusing to seed: identity acceptance fixtures require the isolated mysql service");
}

const password = String(process.env.ACCEPTANCE_USER_PASSWORD || "");
if (password.length < 16) throw new Error("ACCEPTANCE_USER_PASSWORD must contain at least 16 characters");

const prisma = new PrismaClient();
const passwordHash = await bcryptjs.hash(password, 12);
const acceptanceCustomerIds = {
  a: "00000000-0000-4000-8000-00000000000a",
  b: "00000000-0000-4000-8000-00000000000b",
} as const;

const fixtures: Array<{
  id: string;
  email: string;
  name: string;
  role: Role;
  region: string;
  territories: Array<{ province: string; cities: string[] }>;
  viewScope: string;
}> = [
  {
    id: "identity-acceptance-audit",
    email: "accept-audit@dachuan.invalid",
    name: "身份验收审计用户",
    role: "SUPER_ADMIN",
    region: "验收环境",
    territories: [],
    viewScope: "ALL",
  },
  {
    id: "identity-acceptance-sales-a",
    email: process.env.ACCEPTANCE_SALES_A_EMAIL || "accept-sales-a@dachuan.invalid",
    name: "身份验收销售甲",
    role: "SALES",
    region: "华东",
    territories: [{ province: "山东省", cities: ["济南市"] }],
    viewScope: "TERRITORY",
  },
  {
    id: "identity-acceptance-sales-b",
    email: process.env.ACCEPTANCE_SALES_B_EMAIL || "accept-sales-b@dachuan.invalid",
    name: "身份验收销售乙",
    role: "FOREIGN_TRADE",
    region: "海外",
    territories: [{ province: "海外", cities: [] }],
    viewScope: "TERRITORY",
  },
  {
    id: "identity-acceptance-purchase",
    email: process.env.ACCEPTANCE_PURCHASE_EMAIL || "accept-purchase@dachuan.invalid",
    name: "身份验收采购",
    role: "PURCHASE",
    region: "总部",
    territories: [],
    viewScope: "ALL",
  },
  {
    id: "identity-acceptance-warehouse",
    email: process.env.ACCEPTANCE_WAREHOUSE_EMAIL || "accept-warehouse@dachuan.invalid",
    name: "身份验收仓库",
    role: "WAREHOUSE",
    region: "总部",
    territories: [],
    viewScope: "ALL",
  },
  {
    id: "identity-acceptance-admin",
    email: process.env.ACCEPTANCE_ADMIN_EMAIL || "accept-admin@dachuan.invalid",
    name: "身份验收管理员",
    role: "SUPER_ADMIN",
    region: "总部",
    territories: [],
    viewScope: "ALL",
  },
];

try {
  for (const fixture of fixtures) {
    await prisma.user.upsert({
      where: { id: fixture.id },
      create: { ...fixture, password: passwordHash, isActive: true },
      update: {
        name: fixture.name,
        password: passwordHash,
        role: fixture.role,
        region: fixture.region,
        territories: fixture.territories,
        viewScope: fixture.viewScope,
        isActive: true,
      },
    });
  }
  const customerFixtures = [
    {
      id: acceptanceCustomerIds.a,
      companyName: "身份验收山东客户",
      contactName: "验收联系人甲",
      province: "山东省",
      city: "济南市",
      region: "华东",
      businessLine: "国内销售",
      assignedUserId: "identity-acceptance-sales-a",
    },
    {
      id: acceptanceCustomerIds.b,
      companyName: "身份验收外贸客户",
      contactName: "验收联系人乙",
      province: "海外",
      city: null,
      region: "海外",
      businessLine: "外贸",
      assignedUserId: "identity-acceptance-sales-b",
    },
  ];
  for (const fixture of customerFixtures) {
    await prisma.customer.upsert({
      where: { id: fixture.id },
      create: {
        ...fixture,
        customerSource: "身份验收隔离数据",
        customerType: "END_USER",
        customerLevel: "B",
        interestTags: [],
      },
      update: {
        companyName: fixture.companyName,
        contactName: fixture.contactName,
        province: fixture.province,
        city: fixture.city,
        region: fixture.region,
        businessLine: fixture.businessLine,
        assignedUserId: fixture.assignedUserId,
        deletedAt: null,
      },
    });
  }
  const acceptanceDate = new Date("2026-07-20T00:00:00.000Z");
  await prisma.product.upsert({
    where: { id: "identity-acceptance-product" },
    create: {
      id: "identity-acceptance-product",
      model: "IDENTITY-ACCEPTANCE-MACHINE",
      category: "隔离验收设备",
      productType: "MAIN",
      isActive: true,
    },
    update: { category: "隔离验收设备", productType: "MAIN", isActive: true },
  });
  for (const suffix of ["a", "b"] as const) {
    const customerId = acceptanceCustomerIds[suffix];
    const userId = `identity-acceptance-sales-${suffix}`;
    await prisma.followRecord.upsert({
      where: { id: `identity-acceptance-follow-sales-${suffix}` },
      create: {
        id: `identity-acceptance-follow-sales-${suffix}`,
        customerId,
        userId,
        followType: "PHONE",
        content: `身份验收跟进记录-${suffix}`,
        result: "隔离验收完成",
      },
      update: { customerId, userId, content: `身份验收跟进记录-${suffix}`, result: "隔离验收完成" },
    });
    await prisma.contract.upsert({
      where: { id: `identity-acceptance-contract-sales-${suffix}` },
      create: {
        id: `identity-acceptance-contract-sales-${suffix}`,
        contractNo: `IDENTITY-ACCEPTANCE-CONTRACT-${suffix.toUpperCase()}`,
        signedDate: acceptanceDate,
        customerId,
        salesUserId: userId,
        productId: "identity-acceptance-product",
        equipmentName: "隔离验收设备",
        equipmentModel: "IDENTITY-ACCEPTANCE-MACHINE",
        amount: 1,
        unpaidAmount: 1,
        createdById: userId,
      },
      update: {
        signedDate: acceptanceDate,
        customerId,
        salesUserId: userId,
        productId: "identity-acceptance-product",
        equipmentName: "隔离验收设备",
        equipmentModel: "IDENTITY-ACCEPTANCE-MACHINE",
        amount: 1,
        unpaidAmount: 1,
        deletedAt: null,
      },
    });
    await prisma.shipment.upsert({
      where: { id: `identity-acceptance-shipment-sales-${suffix}` },
      create: {
        id: `identity-acceptance-shipment-sales-${suffix}`,
        contractId: `identity-acceptance-contract-sales-${suffix}`,
        shipmentDate: acceptanceDate,
        receivingAddress: `身份验收地址-${suffix}`,
        driverPhone: "00000000000",
        equipmentName: "隔离验收设备",
        quantity: 1,
        createdById: userId,
      },
      update: {
        contractId: `identity-acceptance-contract-sales-${suffix}`,
        shipmentDate: acceptanceDate,
        receivingAddress: `身份验收地址-${suffix}`,
        driverPhone: "00000000000",
        equipmentName: "隔离验收设备",
        quantity: 1,
        createdById: userId,
      },
    });
  }
  await prisma.supplier.upsert({
    where: { id: "identity-acceptance-supplier" },
    create: { id: "identity-acceptance-supplier", name: "身份验收供应商", contactName: "验收联系人", phone: "00000000000" },
    update: { name: "身份验收供应商", contactName: "验收联系人", phone: "00000000000", isActive: true, deletedAt: null },
  });
  await prisma.warehouse.upsert({
    where: { id: "identity-acceptance-warehouse-record" },
    create: { id: "identity-acceptance-warehouse-record", name: "身份验收仓库", code: "IDENTITY-ACCEPTANCE-WH" },
    update: { name: "身份验收仓库", isActive: true },
  });
  await prisma.materialCategory.upsert({
    where: { id: "identity-acceptance-material-category" },
    create: { id: "identity-acceptance-material-category", name: "身份验收物料分类", code: "IDENTITY-ACCEPTANCE-MC", warningThreshold: 5 },
    update: { name: "身份验收物料分类", warningThreshold: 5 },
  });
  await prisma.material.upsert({
    where: { id: "identity-acceptance-material" },
    create: {
      id: "identity-acceptance-material",
      code: "IDENTITY-ACCEPTANCE-MATERIAL",
      name: "身份验收物料",
      categoryId: "identity-acceptance-material-category",
      safetyStock: 5,
      isActive: true,
    },
    update: { name: "身份验收物料", categoryId: "identity-acceptance-material-category", safetyStock: 5, isActive: true, deletedAt: null },
  });
  await prisma.inventory.upsert({
    where: { id: "identity-acceptance-inventory" },
    create: {
      id: "identity-acceptance-inventory",
      warehouseId: "identity-acceptance-warehouse-record",
      materialId: "identity-acceptance-material",
      quantity: 2,
      totalAmount: 2,
    },
    update: { warehouseId: "identity-acceptance-warehouse-record", materialId: "identity-acceptance-material", quantity: 2, totalAmount: 2 },
  });
  await prisma.purchaseOrder.upsert({
    where: { id: "identity-acceptance-purchase-order" },
    create: {
      id: "identity-acceptance-purchase-order",
      orderNo: "IDENTITY-ACCEPTANCE-PO",
      supplierId: "identity-acceptance-supplier",
      supplierNameSnapshot: "身份验收供应商",
      orderDate: acceptanceDate,
      status: "ORDERED",
      createdById: "identity-acceptance-purchase",
    },
    update: { supplierId: "identity-acceptance-supplier", supplierNameSnapshot: "身份验收供应商", orderDate: acceptanceDate, status: "ORDERED", deletedAt: null },
  });
  await prisma.bomHeader.upsert({
    where: { id: "identity-acceptance-bom" },
    create: { id: "identity-acceptance-bom", productId: "identity-acceptance-product", version: "identity-acceptance-v1", isActive: true },
    update: { productId: "identity-acceptance-product", version: "identity-acceptance-v1", isActive: true },
  });
  await prisma.productionOrder.upsert({
    where: { id: "identity-acceptance-production-order" },
    create: {
      id: "identity-acceptance-production-order",
      orderNo: "IDENTITY-ACCEPTANCE-PRODUCTION",
      productId: "identity-acceptance-product",
      productModelSnapshot: "IDENTITY-ACCEPTANCE-MACHINE",
      productNameSnapshot: "隔离验收设备",
      quantity: 1,
      bomId: "identity-acceptance-bom",
      bomVersionSnapshot: "identity-acceptance-v1",
      warehouseId: "identity-acceptance-warehouse-record",
      status: "ISSUED",
      createdById: "identity-acceptance-admin",
    },
    update: {
      productId: "identity-acceptance-product",
      productModelSnapshot: "IDENTITY-ACCEPTANCE-MACHINE",
      productNameSnapshot: "隔离验收设备",
      quantity: 1,
      bomId: "identity-acceptance-bom",
      bomVersionSnapshot: "identity-acceptance-v1",
      warehouseId: "identity-acceptance-warehouse-record",
      status: "ISSUED",
      isCurrent: true,
      deletedAt: null,
    },
  });
  await prisma.productionOrderMaterial.upsert({
    where: { id: "identity-acceptance-production-material" },
    create: {
      id: "identity-acceptance-production-material",
      productionOrderId: "identity-acceptance-production-order",
      materialId: "identity-acceptance-material",
      materialCodeSnapshot: "IDENTITY-ACCEPTANCE-MATERIAL",
      materialNameSnapshot: "身份验收物料",
      unitSnapshot: "件",
      perUnitQuantity: 1,
      requiredQuantity: 1,
      bomVersionSnapshot: "identity-acceptance-v1",
    },
    update: {
      productionOrderId: "identity-acceptance-production-order",
      materialId: "identity-acceptance-material",
      materialCodeSnapshot: "IDENTITY-ACCEPTANCE-MATERIAL",
      materialNameSnapshot: "身份验收物料",
      unitSnapshot: "件",
      perUnitQuantity: 1,
      requiredQuantity: 1,
      bomVersionSnapshot: "identity-acceptance-v1",
    },
  });
  const leadId = "10000000-0000-4000-8000-000000000001";
  await prisma.lead.upsert({
    where: { id: leadId },
    create: {
      id: leadId,
      companyName: "身份验收线索公司",
      contactName: "验收联系人",
      source: "MANUAL",
      searchKeyword: "身份验收机床",
      aiScore: 88,
      profile: { fixture: "identity-acceptance" },
      sourceModelVersion: "identity-acceptance-model",
      extractorVersion: "identity-acceptance-extractor",
      idempotencyKey: "identity-acceptance-lead-idempotency",
      dedupKey: "identity-acceptance-lead-dedup",
      reviewStatus: "HIGH_INTENT",
      reviewedByUserId: "identity-acceptance-admin",
      reviewedAt: acceptanceDate,
      feedbackVersion: 1,
    },
    update: {
      companyName: "身份验收线索公司",
      searchKeyword: "身份验收机床",
      aiScore: 88,
      reviewStatus: "HIGH_INTENT",
      reviewedByUserId: "identity-acceptance-admin",
      reviewedAt: acceptanceDate,
      feedbackVersion: 1,
    },
  });
  const feedbackEventFixture = {
    id: "10000000-0000-4000-8000-000000000002",
    leadId,
    reviewReasonCode: "ACCEPTANCE",
    comment: "隔离验收反馈事件",
    reviewedByUserId: "identity-acceptance-admin",
    reviewedAt: acceptanceDate,
  };
  const existingFeedbackEvent = await prisma.leadFeedbackEvent.findUnique({
    where: { id: feedbackEventFixture.id },
    select: {
      id: true,
      leadId: true,
      reviewReasonCode: true,
      comment: true,
      reviewedByUserId: true,
      reviewedAt: true,
    },
  });
  if (!existingFeedbackEvent) {
    await prisma.leadFeedbackEvent.create({ data: feedbackEventFixture });
  } else if (
    existingFeedbackEvent.leadId !== feedbackEventFixture.leadId
    || existingFeedbackEvent.reviewReasonCode !== feedbackEventFixture.reviewReasonCode
    || existingFeedbackEvent.comment !== feedbackEventFixture.comment
    || existingFeedbackEvent.reviewedByUserId !== feedbackEventFixture.reviewedByUserId
    || existingFeedbackEvent.reviewedAt.getTime() !== feedbackEventFixture.reviewedAt.getTime()
  ) {
    throw new Error("Refusing to overwrite immutable identity acceptance lead feedback event");
  }
  console.log(`Seeded ${fixtures.length} isolated identity acceptance users and FULL_READ_ONLY fixtures`);
} finally {
  await prisma.$disconnect();
}
