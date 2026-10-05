import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const migration = read("prisma/migrations/20260803140000_v2_phase5_stock_in_void/migration.sql");
const rollback = read("prisma/migrations/20260803140000_v2_phase5_stock_in_void/rollback.sql");
const schema = read("prisma/schema.prisma");

describe("phase 5 StockIn void migration safety", () => {
  it("adds an explicit state that preserves every historical StockIn as confirmed", () => {
    expect(migration).toContain("ADD COLUMN `status` ENUM('DRAFT','CONFIRMED','VOIDED') NOT NULL DEFAULT 'CONFIRMED'");
    expect(schema).toMatch(/model StockIn \{[\s\S]*?status\s+StockInStatus\s+@default\(CONFIRMED\)/);
    expect(schema).toContain("enum StockInStatus {");
    expect(schema).toContain("CONFIRMED");
    expect(migration).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE\s+FROM)\b/im);
  });

  it("uses only additive DDL and never recalculates inventory or historical movements", () => {
    expect(migration).not.toMatch(/^\s*(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE|MODIFY|RENAME)\b/im);
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+`(?:erp_inventories|erp_stock_movements)`/i);
    expect(migration).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+`?(?:erp_inventories|erp_stock_movements|erp_stock_ins|erp_stock_in_items)`?/i);
    expect(migration).toContain("CREATE TABLE `erp_stock_in_voids`");
    expect(migration).toContain("CREATE TABLE `erp_stock_in_void_items`");
    expect(migration).toContain("UNIQUE INDEX `uq_stock_in_void_stock_in`");
  });

  it("limits rollback to a zero-void pre-production guard", () => {
    expect(rollback).toContain("WHERE `status` = 'VOIDED'");
    expect(rollback).toContain("@phase5_void_audit_count = 0");
    expect(rollback).toContain("@phase5_rollback_allowed = 1");
    expect(rollback).not.toMatch(/DROP\s+(?:DATABASE|SCHEMA)/i);
    expect(rollback).not.toMatch(/\b(?:TRUNCATE|DELETE\s+FROM|UPDATE\s+`?erp_)\b/i);
  });
});
