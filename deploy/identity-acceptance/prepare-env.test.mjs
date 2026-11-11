import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./prepare-env.mjs", import.meta.url));
const validateScript = fileURLToPath(new URL("./validate-env.mjs", import.meta.url));
const template = fileURLToPath(new URL("./.env.identity-acceptance.example", import.meta.url));
const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

describe("identity acceptance environment preparation", () => {
  it("generates the complete 24-tool business allowlist in FULL_READ_ONLY mode", () => {
    const directory = mkdtempSync(join(tmpdir(), "identity-acceptance-env-"));
    temporaryDirectories.push(directory);
    const output = join(directory, "acceptance.env");

    const result = spawnSync(process.execPath, [script, template, output], {
      encoding: "utf8",
      env: { ...process.env, IDENTITY_ACCEPTANCE_TOOL_MODE: "FULL_READ_ONLY" },
    });

    expect(result.status).toBe(0);
    const content = readFileSync(output, "utf8");
    const allowlist = content.match(/^MCP_TOOL_ALLOWLIST=(.*)$/m)?.[1].split(",") ?? [];

    expect(allowlist).toHaveLength(24);
    expect(new Set(allowlist).size).toBe(24);
    expect(allowlist).toEqual(expect.arrayContaining(["lead_list", "lead_get", "lead_stats"]));
    expect(content).toMatch(/^AGENT_AUTH_PUBLIC_KEYS_JSON=\[/m);
    expect(content).not.toMatch(/LEAD_WRITER_AUTH_|LEAD_E2E_|MCP_COMMAND_/);
    expect(spawnSync(process.execPath, [validateScript, output], { encoding: "utf8" })).toMatchObject({ status: 0, stderr: "" });
  });
});
