import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const verifier = fileURLToPath(new URL("./verify-db-init-privilege-log.mjs", import.meta.url));

function verify(input) {
  return spawnSync(process.execPath, [verifier], {
    encoding: "utf8",
    input,
  });
}

const valid = verify([
  "migration output",
  "MCP_ACCEPTANCE_DUAL_DATABASE_PRIVILEGES=PASS",
  "MCP_ACCEPTANCE_LEAD_WRITER_PRIVILEGES=PASS",
  "",
].join("\n"));
assert.equal(valid.status, 0, valid.stderr);
assert.match(valid.stdout, /^IDENTITY_ACCEPTANCE_DB_INIT_PRIVILEGES=PASS\s*$/);

const missingReadGate = verify("MCP_ACCEPTANCE_LEAD_WRITER_PRIVILEGES=PASS\n");
assert.notEqual(missingReadGate.status, 0);
assert.doesNotMatch(missingReadGate.stderr, /MCP_ACCEPTANCE_LEAD_WRITER_PRIVILEGES=PASS/);

const missingWriteGate = verify("MCP_ACCEPTANCE_DUAL_DATABASE_PRIVILEGES=PASS\n");
assert.notEqual(missingWriteGate.status, 0);
assert.doesNotMatch(missingWriteGate.stderr, /MCP_ACCEPTANCE_DUAL_DATABASE_PRIVILEGES=PASS/);

const carriageReturns = verify(
  "MCP_ACCEPTANCE_DUAL_DATABASE_PRIVILEGES=PASS\r\nMCP_ACCEPTANCE_LEAD_WRITER_PRIVILEGES=PASS\r\n",
);
assert.equal(carriageReturns.status, 0, carriageReturns.stderr);

console.log("DB_INIT_PRIVILEGE_LOG_TEST=PASS");
