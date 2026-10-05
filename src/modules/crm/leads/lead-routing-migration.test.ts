import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = "prisma/migrations/20260826150000_extend_lead_source_url_and_routing_outcome/migration.sql";
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Lead source URL and routing observability migration", () => {
  it("widens sourceUrl and adds a nullable routing outcome without rewriting history", () => {
    const sql = read(migrationPath);
    expect(sql).toContain("MODIFY COLUMN `sourceUrl` VARCHAR(2048) NULL");
    expect(sql).toContain("ADD COLUMN `routingOutcome` ENUM(");
    expect(sql).toContain("'ASSIGNED'");
    expect(sql).toContain("'REGION_UNRESOLVED'");
    expect(sql).toContain("'NO_MATCHING_ASSIGNEE'");
    expect(sql).toContain("'MULTIPLE_MATCHING_ASSIGNEES'");
    expect(sql).toContain("'ROUTING_UNAVAILABLE'");
    expect(sql).toContain(") NULL;");
    expect(sql).not.toMatch(/\b(?:DROP|DELETE|TRUNCATE)\b/iu);
  });

  it("keeps Prisma sourceUrl and routingOutcome aligned with the additive SQL", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).toContain("sourceUrl     String?    @db.VarChar(2048)");
    expect(schema).toContain("routingOutcome LeadRoutingOutcome?");
    expect(schema).toContain("@@index([routingOutcome, createdAt])");
  });
});
