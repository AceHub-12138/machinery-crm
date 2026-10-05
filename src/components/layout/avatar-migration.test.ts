import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(
  resolve(process.cwd(), "prisma/schema.prisma"),
  "utf8",
);
const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260805110000_ui_1b_user_avatar/migration.sql",
  ),
  "utf8",
);

describe("UI-1B avatar migration", () => {
  it("adds exactly one nullable avatar path column without a default", () => {
    const userModel = schema.match(/model User \{[\s\S]*?\n\}/)?.[0] || "";

    expect(userModel).toMatch(/\n\s+avatarPath\s+String\?/);
    expect(migration.trim()).toBe(
      "ALTER TABLE `users` ADD COLUMN `avatarPath` VARCHAR(191) NULL;",
    );
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE|DEFAULT)\b/i);
  });
});
