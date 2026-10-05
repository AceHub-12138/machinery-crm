import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("LeadWriteAudit UTC timestamp contract", () => {
  it.each([
    ["runtime command writer", "src/lib/mcp/prisma-command-data-source.ts"],
    ["isolated acceptance privilege probe", "scripts/provision-mcp-acceptance-accounts.mjs"],
  ])("%s never relies on the MySQL session-local createdAt default", (_label, path) => {
    const source = read(path);
    const insert = source.match(/INSERT INTO lead_write_audits[\s\S]*?`;/u)?.[0] ?? "";

    expect(insert).toContain("createdAt");
    expect(insert).toContain("UTC_TIMESTAMP(3)");
    expect(insert).not.toMatch(/\bCURRENT_TIMESTAMP\b/iu);
  });
});
