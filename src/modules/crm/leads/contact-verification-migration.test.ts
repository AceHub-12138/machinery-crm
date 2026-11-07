import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const directory = "prisma/migrations/20261107010000_add_lead_contact_verification/";
describe("contact verification additive migration", () => {
  it("adds nullable columns without rewriting historical rows and restricts deletes", () => {
    const sql = readFileSync(directory + "migration.sql", "utf8");
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\s+(TABLE|FROM|INTO|`leads`)/i);
    for (const line of sql.split("\n").filter((line) => line.includes("ADD COLUMN"))) {
      expect(line.trim()).toMatch(/ NULL[,;]?$/);
      expect(line).not.toMatch(/NOT NULL|DEFAULT/);
    }
    expect(sql.match(/ON DELETE RESTRICT/g)).toHaveLength(3);
    expect(sql.match(/utf8mb4_unicode_ci/g)).toHaveLength(2);
    expect(sql).toContain("`quotaDate` CHAR(10)");
  });
  it("documents data loss in the explicitly separate rollback", () => {
    const sql = readFileSync(directory + "rollback.sql", "utf8");
    expect(sql).toContain("执行前必须导出");
    expect(sql).not.toMatch(/DROP TABLE `(?:leads|users|lead_hunt_candidates)`/);
  });
});
