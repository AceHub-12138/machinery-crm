import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = "prisma/migrations/20260810090000_add_sales_target/migration.sql";
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("sales target migration boundary", () => {
  it("creates only sales_targets and never mutates or drops an existing table", () => {
    const sql = read(migrationPath);
    expect(sql.match(/CREATE TABLE/gi)).toHaveLength(1);
    expect(sql).toContain("CREATE TABLE `sales_targets`");
    expect(sql).toContain("ENUM('MONTH', 'YEAR')");
    expect(sql).toContain("ENUM('CONTRACT_AMOUNT', 'PAID_AMOUNT')");
    expect(sql).not.toMatch(/\bDROP\b/i);
    for (const statement of sql.split(";").filter((item) => /ALTER TABLE/i.test(item))) {
      expect(statement).toMatch(/ALTER TABLE `sales_targets`/i);
    }
  });

  it("keeps the schema change to the approved model, enums, and User back-relations", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).toContain("createdSalesTargets           SalesTarget[]");
    expect(schema).toContain("updatedSalesTargets           SalesTarget[]");
    expect(schema).toContain("model SalesTarget {");
    expect(schema).toContain("amount      Decimal           @db.Decimal(14, 2)");
    expect(schema).toContain('@@unique([periodType, periodYear, periodIndex, metric, salesUserId], map: "uq_sales_target_scope")');
  });
});
