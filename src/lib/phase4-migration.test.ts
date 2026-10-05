import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
const migration = readFileSync(resolve(process.cwd(), "prisma/migrations/20260715100000_erp_phase4_procurement_delivery/migration.sql"), "utf8");
const rollback = readFileSync(resolve(process.cwd(), "prisma/migrations/20260715100000_erp_phase4_procurement_delivery/rollback.sql"), "utf8");
describe("phase4 procurement migration", () => {
  it("keeps explicitly named indexes and constraints within the MySQL 64 character limit", () => {
    const names = [...migration.matchAll(/(?:INDEX|CONSTRAINT)\s+`([^`]+)`/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(20);
    expect(names.filter((name) => name.length > 64)).toEqual([]);
  });
  it("is additive and ships a rollback script", () => {
    expect(migration).not.toMatch(/^\s*(?:DROP|TRUNCATE|DELETE\s+FROM)\b/im);
    expect(rollback).toContain("DROP TABLE `erp_purchase_demands`");
    expect(rollback).toContain("DROP COLUMN `deliveryDateSnapshot`");
  });
});
