import { createHash, randomUUID } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importJWK, SignJWT } from "jose";
import { createClient } from "redis";

function required(environment, name) {
  const value = String(environment[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function boundedInteger(environment, name, minimum, maximum, fallback) {
  const value = Number(environment[name] || fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function parseJson(value, name) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
}

function privateEd25519Jwk(value) {
  const parsed = parseJson(value, "LEAD_SERVICE_ASSERTION_PRIVATE_JWK_JSON");
  if (
    !parsed
    || parsed.kty !== "OKP"
    || parsed.crv !== "Ed25519"
    || typeof parsed.x !== "string"
    || typeof parsed.d !== "string"
  ) {
    throw new Error("LEAD_SERVICE_ASSERTION_PRIVATE_JWK_JSON must be a private Ed25519 JWK");
  }
  return parsed;
}

function humanPublicKeyIdentities(value) {
  const parsed = parseJson(value, "AGENT_AUTH_PUBLIC_KEYS_JSON");
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("AGENT_AUTH_PUBLIC_KEYS_JSON must contain public Ed25519 keys");
  }
  return new Set(parsed.map((entry, index) => {
    const key = entry?.publicJwk;
    if (key?.kty !== "OKP" || key.crv !== "Ed25519" || typeof key.x !== "string" || "d" in key) {
      throw new Error(`AGENT_AUTH_PUBLIC_KEYS_JSON entry ${index + 1} must be a public Ed25519 key`);
    }
    return `${key.kty}:${key.crv}:${key.x}`;
  }));
}

function normalizedPrefix(value, name) {
  const prefix = value.trim().replace(/:+$/, "");
  if (!prefix) throw new Error(`${name} is required`);
  return prefix;
}

export function loadLeadServiceAssertionConfig(environment = process.env) {
  const audience = required(environment, "LEAD_SERVICE_ASSERTION_AUDIENCE");
  const humanAudience = required(environment, "AGENT_AUTH_AUDIENCE");
  if (audience === humanAudience) {
    throw new Error("Lead SERVICE assertion audience must differ from the human assertion audience");
  }

  const privateJwkInput = String(environment.LEAD_SERVICE_ASSERTION_PRIVATE_JWK_JSON || "").trim();
  const privateJwkFile = String(environment.LEAD_SERVICE_ASSERTION_PRIVATE_JWK_FILE || "").trim();
  if (Boolean(privateJwkInput) === Boolean(privateJwkFile)) {
    throw new Error("Configure exactly one Lead SERVICE assertion private JWK source");
  }
  const privateJwk = privateEd25519Jwk(privateJwkInput || readFileSync(resolve(privateJwkFile), "utf8"));
  const humanKeys = humanPublicKeyIdentities(required(environment, "AGENT_AUTH_PUBLIC_KEYS_JSON"));
  if (humanKeys.has(`${privateJwk.kty}:${privateJwk.crv}:${privateJwk.x}`)) {
    throw new Error("Lead SERVICE signing key must not reuse a human assertion key");
  }

  const redisPrefix = normalizedPrefix(
    required(environment, "LEAD_SERVICE_ASSERTION_REDIS_PREFIX"),
    "LEAD_SERVICE_ASSERTION_REDIS_PREFIX",
  );
  const humanRedisPrefix = normalizedPrefix(
    required(environment, "AGENT_AUTH_REDIS_PREFIX"),
    "AGENT_AUTH_REDIS_PREFIX",
  );
  if (redisPrefix === humanRedisPrefix) {
    throw new Error("Lead SERVICE assertion Redis prefix must differ from the human assertion Redis prefix");
  }

  const redisUrl = required(environment, "LEAD_SERVICE_ASSERTION_REDIS_URL");
  const parsedRedisUrl = new URL(redisUrl);
  if (!["redis:", "rediss:"].includes(parsedRedisUrl.protocol)) {
    throw new Error("LEAD_SERVICE_ASSERTION_REDIS_URL must use redis or rediss");
  }

  const principalId = required(environment, "LEAD_SERVICE_ASSERTION_PRINCIPAL_ID");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,190}$/.test(principalId)) {
    throw new Error("LEAD_SERVICE_ASSERTION_PRINCIPAL_ID must be a stable service identifier");
  }

  return {
    issuer: required(environment, "LEAD_SERVICE_ASSERTION_ISSUER"),
    audience,
    ttlSeconds: boundedInteger(
      environment,
      "LEAD_SERVICE_ASSERTION_TOKEN_TTL_SECONDS",
      300,
      900,
      300,
    ),
    activeKid: required(environment, "LEAD_SERVICE_ASSERTION_ACTIVE_KID"),
    privateJwk,
    principalId,
    redisUrl,
    redisPrefix,
    rateLimitPerMinute: boundedInteger(
      environment,
      "LEAD_SERVICE_ASSERTION_RATE_LIMIT_PER_MINUTE",
      1,
      10_000,
      30,
    ),
  };
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createRedisLeadServiceAssertionStateStore(redisUrl, prefix) {
  const client = createClient({ url: redisUrl });
  let connecting = null;

  async function ready() {
    if (client.isOpen) return client;
    connecting ??= client.connect().finally(() => {
      connecting = null;
    });
    await connecting;
    return client;
  }

  return {
    async consume(subject, limit, windowSeconds) {
      const redis = await ready();
      const key = `${prefix}:rate:${digest(subject)}`;
      const count = await redis.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n",
        { keys: [key], arguments: [String(windowSeconds)] },
      );
      return Number(count) <= limit;
    },
    async register(jti, ttlSeconds) {
      const redis = await ready();
      await redis.set(`${prefix}:jti:${digest(jti)}`, "active", { EX: ttlSeconds });
    },
    async close() {
      await connecting?.catch(() => undefined);
      if (!client.isOpen) return;
      try {
        await client.quit();
      } catch {
        await client.disconnect().catch(() => undefined);
      }
    },
  };
}

export async function createLeadServiceAssertionIssuer(config, options = {}) {
  const signingKey = await importJWK(config.privateJwk, "EdDSA");
  const stateStore = options.stateStore
    ?? createRedisLeadServiceAssertionStateStore(config.redisUrl, config.redisPrefix);
  const now = options.now ?? (() => new Date());
  const createJti = options.createJti ?? randomUUID;

  return {
    async issue() {
      if (!(await stateStore.consume(config.principalId, config.rateLimitPerMinute, 60))) {
        throw new Error("Lead SERVICE assertion issuance rate limit exceeded");
      }
      const issuedAt = Math.floor(now().getTime() / 1000);
      const expiresAt = issuedAt + config.ttlSeconds;
      const jti = createJti();
      const token = await new SignJWT({ principalType: "SERVICE", scope: ["lead:create"] })
        .setProtectedHeader({ alg: "EdDSA", kid: config.activeKid, typ: "JWT" })
        .setIssuer(config.issuer)
        .setSubject(config.principalId)
        .setAudience(config.audience)
        .setIssuedAt(issuedAt)
        .setNotBefore(issuedAt)
        .setExpirationTime(expiresAt)
        .setJti(jti)
        .sign(signingKey);
      await stateStore.register(jti, config.ttlSeconds);
      return { token, jti, expiresAt: new Date(expiresAt * 1000) };
    },
    close: () => stateStore.close(),
  };
}

function outputPath(arguments_) {
  const index = arguments_.indexOf("--output");
  if (index < 0 || !arguments_[index + 1] || arguments_.length !== 2) {
    throw new Error("Usage: node scripts/issue-lead-service-assertion.mjs --output <restricted-file>");
  }
  return resolve(arguments_[index + 1]);
}

async function main() {
  const target = outputPath(process.argv.slice(2));
  const issuer = await createLeadServiceAssertionIssuer(loadLeadServiceAssertionConfig());
  try {
    const issued = await issuer.issue();
    writeFileSync(target, `${issued.token}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    chmodSync(target, 0o600);
    console.log(`LEAD_SERVICE_ASSERTION_ISSUED=PASS expiresAt=${issued.expiresAt.toISOString()} output=${target}`);
  } finally {
    await issuer.close();
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    console.error(`LEAD_SERVICE_ASSERTION_ISSUED=FAIL ${String(error?.message || error).slice(0, 300)}`);
    process.exitCode = 1;
  });
}
