import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const outputArg = args[0];
if (!outputArg) {
  console.error("Usage: pnpm agent:keygen -- <secure-output.json> [kid]");
  process.exit(1);
}
const outputPath = resolve(outputArg);
const kid = args[1] || `dachuan-agent-${new Date().toISOString().slice(0, 10)}`;
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicJwk = publicKey.export({ format: "jwk" });
const privateJwk = privateKey.export({ format: "jwk" });

writeFileSync(outputPath, `${JSON.stringify([{ kid, publicJwk, privateJwk }], null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
});
console.log(`Ed25519 key file created: ${outputPath}`);
console.log(`Active kid: ${kid}`);
console.log("The private JWK was not printed. Keep the file server-side and do not commit it.");
