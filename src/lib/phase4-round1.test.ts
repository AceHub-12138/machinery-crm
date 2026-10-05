import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("phase 4 round 1 migration safety", () => {
  const migration = read("prisma/migrations/20260714100000_erp_phase4_round1_roles_contract_item/migration.sql");

  it("adds only the compatible procurement role and nullable contract item link", () => {
    expect(migration).toContain("'PURCHASE'");
    expect(migration).toContain("ADD COLUMN `contractItemId` VARCHAR(191) NULL");
    expect(migration).toContain("ADD COLUMN `bomVersionSnapshot` VARCHAR(191) NULL");
    expect(migration).toContain("UNIQUE INDEX `uq_po_source_request`");
    expect(migration).toContain("ON DELETE SET NULL");
    expect(migration).not.toMatch(/\b(DROP\s+(TABLE|COLUMN)|DELETE\s+FROM|TRUNCATE|RESET)\b/i);
  });

  it("keeps every explicit database identifier below the MySQL 64 character limit", () => {
    const names = [...migration.matchAll(/(?:INDEX|CONSTRAINT)\s+`([^`]+)`/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => name.length < 64)).toBe(true);
  });
});

describe("production order information boundary", () => {
  it("does not select customer data for contract-to-production conversion", () => {
    const source = read("src/app/api/erp/production-contracts/route.ts");
    expect(source).not.toMatch(/customer\s*:/);
    expect(source).not.toMatch(/companyName\s*:/);
    expect(source).not.toMatch(/contactName\s*:/);
    expect(source).toContain("contractNo: true");
    expect(source).toContain("estimatedShipmentDate: true");
    expect(source).toContain("salesUser:");
  });

  it("stores only contract identifiers and no customer snapshot on ProductionOrder", () => {
    const schema = read("prisma/schema.prisma");
    const model = schema.match(/model ProductionOrder \{[\s\S]*?\n\}/)?.[0] || "";
    expect(model).toContain("contractId");
    expect(model).toContain("contractItemId");
    expect(model).not.toMatch(/customer(Name|Contact|Phone|Address|Invoice)/i);
  });

  it("creates selected contract items atomically and records their sources", () => {
    const route = read("src/app/api/erp/production-orders/from-contract/route.ts");
    expect(route).toContain("TransactionIsolationLevel.Serializable");
    expect(route).toContain("contractItemId: created.contractItemId");
    expect(route).toContain("BATCH_CREATE_PRODUCTION_ORDERS_FROM_CONTRACT");
  });

  it("does not count the contract draft itself while reopening it for edit", () => {
    expect(read("src/app/api/erp/production-contracts/route.ts")).toContain("excludeOrderId");
    expect(read("src/app/(app)/erp/production-orders/[id]/page.tsx")).toContain("excludeOrderId=");
  });

  it("includes unlinked legacy orders only when their contract item is unambiguous", () => {
    const service = read("src/lib/production-orders.ts");
    expect(service).toContain("canResolveLegacyOrders");
    expect(service).toContain("历史工单未关联具体合同明细");
  });
});

describe("draft publication and BOM write guards", () => {
  it("uses plain production requirements and exposes separate save and publish actions", () => {
    const page = read("src/app/(app)/erp/production-orders/[id]/page.tsx");
    expect(page).toContain("特殊配置 / 生产要求");
    expect(page).not.toContain("配置（JSON 对象");
    expect(page).toContain("保存草稿");
    expect(page).toContain("发布工单");
    expect(page).toContain("是否立即执行齐套检查");
    expect(page).toContain("if (isNew) router.replace(`/erp/production-orders/${orderId}`)");
  });

  it("publishes with the phase4 acceptance kit check and blocks duplicate publication", () => {
    const route = read("src/app/api/erp/production-orders/[id]/issue/route.ts");
    expect(route).toContain("createKitCheckResult");
    expect(route).toContain('triggerType: "ORDER_ISSUE"');
    expect(route).toContain("请勿重复发布");
  });

  it("routes BOM writes through unit and hierarchy validation", () => {
    expect(read("src/app/api/erp/boms/route.ts")).toContain("normalizeBomWriteItems");
    expect(read("src/app/api/erp/boms/[id]/route.ts")).toContain("normalizeBomWriteItems");
  });
});

describe("role enforcement", () => {
  it("uses dedicated server-side write checks for purchase, inventory, BOM and production", () => {
    expect(read("src/app/api/erp/purchase-orders/route.ts")).toContain("canManagePurchaseOrders(user)");
    expect(read("src/app/api/erp/stock-in/route.ts")).toContain("canManageInventory(user)");
    expect(read("src/app/api/erp/boms/route.ts")).toContain("canManageBom(user)");
    expect(read("src/app/api/erp/boms/[id]/route.ts").match(/canManageBom\(user\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(read("src/app/api/erp/material-categories/[id]/route.ts")).toContain("canManageMaterialMaster(user)");
    expect(read("src/app/api/erp/production-orders/[id]/issue/route.ts")).toContain("canPublishProductionOrder(user)");
  });

  it("requires region scopes only for sales roles on both create and update", () => {
    expect(read("src/app/api/users/route.ts")).toContain("roleRequiresRegionScope");
    expect(read("src/app/api/users/[id]/route.ts")).toContain("roleRequiresRegionScope");
    expect(read("src/app/(app)/users/page.tsx")).toContain("roleRequiresRegionScope");
  });

  it("blocks sales from ERP routes and gives internal roles page allowlists", () => {
    const middleware = read("src/middleware.ts");
    expect(middleware).toContain("rolePages");
    expect(middleware).toContain('role === "SALES" || role === "FOREIGN_TRADE"');
  });
});
