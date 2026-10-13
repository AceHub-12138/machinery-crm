import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const validation = 'test -s "$DB_BACKUP" && gzip -t "$DB_BACKUP" && gzip -dc "$DB_BACKUP" | awk \'END { if (NR == 0) exit 1 }\'';

describe("currency deployment backup safeguards", () => {
  it.each(["DEPLOY.md", "STANDALONE_DEPLOY.md"])("%s keeps the dump flag and both empty checks", file => {
    const source = readFileSync(`${root}/${file}`, "utf8");
    expect(source).toMatch(/mysqldump[^\n]*--column-statistics=0/);
    expect(source).toContain("set -euo pipefail");
    expect(source).toContain('test -s "$DB_BACKUP"');
    expect(source).toContain('gzip -t "$DB_BACKUP"');
    expect(source).toContain("if (NR == 0) exit 1");
  });
  it.each([
    ["", false],
    ["-- SQL backup\nCREATE TABLE fixture (id INT);\n", true],
  ])("validates decompressed SQL, including nonempty gzip wrapping empty SQL", (sql, accepted) => {
    const gzip = execFileSync("gzip", ["-c"], { input: sql });
    expect(gzip.length).toBeGreaterThan(0);
    // /dev/stdin is read once by gzip -t and again for the SQL check, so use a Bash-local temp file.
    const result = spawnSync("bash", ["-c", `set -euo pipefail; DB_BACKUP=$(mktemp); trap 'rm -f "$DB_BACKUP"' EXIT; cat > "$DB_BACKUP"; ${validation}`], { input: gzip });
    expect(result.status === 0).toBe(accepted);
  });
});
