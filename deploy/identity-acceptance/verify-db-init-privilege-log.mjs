const requiredMarkers = new Map([
  ["MCP_ACCEPTANCE_DUAL_DATABASE_PRIVILEGES=PASS", "read/audit account isolation"],
  ["MCP_ACCEPTANCE_LEAD_WRITER_PRIVILEGES=PASS", "Lead writer account isolation"],
]);

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;

const lines = new Set(input.split(/\r?\n/));
const missing = [...requiredMarkers]
  .filter(([marker]) => !lines.has(marker))
  .map(([, label]) => label);

if (missing.length > 0) {
  console.error(`Database privilege verification did not emit all required gates: ${missing.join(", ")}.`);
  process.exitCode = 1;
} else {
  console.log("IDENTITY_ACCEPTANCE_DB_INIT_PRIVILEGES=PASS");
}
