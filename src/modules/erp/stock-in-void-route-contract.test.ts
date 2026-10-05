import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(resolve(process.cwd(), "src/app/api/erp/stock-in/[id]/void/route.ts"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "prisma/migrations/20260803140000_v2_phase5_stock_in_void/migration.sql"), "utf8");

describe("StockIn 作废 API 并发与审计契约", () => {
  it("锁定单头和按稳定物料顺序锁库存，且在可串行化事务中有限重试", () => {
    expect(route).toContain("SELECT id FROM erp_stock_ins WHERE id = ${id} FOR UPDATE");
    expect(route).toContain("const materialIds = [...voidQuantityByMaterial.keys()].sort()");
    expect(route).toContain("SELECT id FROM erp_inventories WHERE warehouseId = ${stockIn.warehouseId} AND materialId = ${materialId} FOR UPDATE");
    expect(route).toContain("Prisma.TransactionIsolationLevel.Serializable");
    expect(route).toContain("attempt < 3");
    expect(route).toContain('code === "P2002"');
    expect(route).toContain('code === "P2034"');
    expect(migration).toContain("UNIQUE INDEX `uq_stock_in_void_stock_in`");
  });

  it("保持原入库事实并仅追加作废审计和反向流水", () => {
    expect(route).toContain("tx.stockInVoid.create");
    expect(route).toContain("tx.stockInVoidItem.create");
    expect(route).toContain('type: "STOCK_OUT"');
    expect(route).toContain('refType: "StockInVoid"');
    expect(route).toContain('action: "VOID_STOCK_IN"');
    expect(route).toContain("enqueueKitRechecks");
  });
});
