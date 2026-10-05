const fs = require("node:fs");
const path = require("node:path");

const envPath = path.join(__dirname, ".env");

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;

    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

if (process.env.START_MODE === "next") {
  process.argv = [process.execPath, "next", "start"];
  require("next/dist/bin/next");
} else {
  const rootServer = path.join(__dirname, "server.js");
  const nestedServer = path.join(__dirname, ".next", "standalone", "server.js");
  const serverPath = fs.existsSync(rootServer) ? rootServer : nestedServer;

  if (!fs.existsSync(serverPath)) {
    throw new Error(
      "Standalone server entry not found. Expected server.js or .next/standalone/server.js."
    );
  }

  require(serverPath);
}
