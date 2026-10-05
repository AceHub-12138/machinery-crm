import { importJWK, type JWK } from "jose";
import { AgentAssertionError, createServiceTokenVerifier } from "@/lib/agent-auth/token";
import {
  createRedisAgentAuthStateStore,
  type AgentAuthStateStore,
} from "@/lib/agent-auth/redis-state-store";

type Environment = Record<string, string | undefined>;

export type LeadWriterAuthConfig = {
  issuer: string;
  audience: string;
  ttlSeconds: number;
  keys: Array<{ kid: string; publicJwk: JWK }>;
  redisUrl: string;
  redisPrefix: string;
  rateLimitPerMinute: number;
};

function required(environment: Environment, name: string) {
  const value = String(environment[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(environment: Environment, name: string, fallback: number) {
  const value = Number(environment[name] || fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function publicKeys(value: string, variableName: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${variableName} must be valid JSON`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`${variableName} must contain at least one public Ed25519 key`);
  }
  const seen = new Set<string>();
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`Lead writer auth key ${index + 1} is invalid`);
    const input = entry as Record<string, unknown>;
    if ("privateJwk" in input) throw new Error(`${variableName} must not contain private keys`);
    const kid = String(input.kid || "").trim();
    const publicJwk = input.publicJwk as JWK | undefined;
    if (!kid || seen.has(kid)) throw new Error(`Lead writer auth key ${index + 1} has a missing or duplicate kid`);
    if (publicJwk && Object.prototype.hasOwnProperty.call(publicJwk, "d")) {
      throw new Error(`${variableName} must contain public keys only`);
    }
    if (publicJwk?.kty !== "OKP" || publicJwk.crv !== "Ed25519" || typeof publicJwk.x !== "string") {
      throw new Error(`Lead writer auth key ${kid} requires an Ed25519 publicJwk`);
    }
    seen.add(kid);
    return { kid, publicJwk };
  });
}

export function loadLeadWriterAuthConfig(environment: Environment = process.env): LeadWriterAuthConfig {
  const audience = required(environment, "LEAD_WRITER_AUTH_AUDIENCE");
  const humanAudience = required(environment, "AGENT_AUTH_AUDIENCE");
  if (audience === humanAudience) {
    throw new Error("LEAD_WRITER_AUTH_AUDIENCE must differ from AGENT_AUTH_AUDIENCE");
  }
  const keys = publicKeys(
    required(environment, "LEAD_WRITER_AUTH_KEYS_JSON"),
    "LEAD_WRITER_AUTH_KEYS_JSON",
  );
  const humanPublicKeys = publicKeys(
    required(environment, "AGENT_AUTH_PUBLIC_KEYS_JSON"),
    "AGENT_AUTH_PUBLIC_KEYS_JSON",
  );
  const humanKeyIdentities = new Set(humanPublicKeys.map(({ publicJwk }) => (
    `${publicJwk.kty}:${publicJwk.crv}:${publicJwk.x}`
  )));
  if (keys.some(({ publicJwk }) => humanKeyIdentities.has(`${publicJwk.kty}:${publicJwk.crv}:${publicJwk.x}`))) {
    throw new Error("LEAD_WRITER_AUTH_KEYS_JSON must not reuse an AGENT_AUTH_PUBLIC_KEYS_JSON key");
  }
  const ttlSeconds = positiveInteger(environment, "LEAD_WRITER_AUTH_TOKEN_TTL_SECONDS", 300);
  if (ttlSeconds < 300 || ttlSeconds > 900) {
    throw new Error("LEAD_WRITER_AUTH_TOKEN_TTL_SECONDS must be between 300 and 900");
  }
  return {
    issuer: required(environment, "LEAD_WRITER_AUTH_ISSUER"),
    audience,
    ttlSeconds,
    keys,
    redisUrl: required(environment, "LEAD_WRITER_AUTH_REDIS_URL"),
    redisPrefix: String(environment.LEAD_WRITER_AUTH_REDIS_PREFIX || "dachuan:lead-writer-auth").trim(),
    rateLimitPerMinute: positiveInteger(environment, "LEAD_WRITER_AUTH_RATE_LIMIT_PER_MINUTE", 30),
  };
}

export class LeadWriterRateLimitError extends Error {
  constructor() {
    super("Lead writer service rate limit exceeded");
    this.name = "LeadWriterRateLimitError";
  }
}

export async function createLeadWriterAuthRuntime(
  config: LeadWriterAuthConfig,
  stateStore: AgentAuthStateStore = createRedisAgentAuthStateStore(config.redisUrl, config.redisPrefix),
) {
  const verificationKeys = await Promise.all(config.keys.map(async (entry) => ({
    kid: entry.kid,
    key: await importJWK(entry.publicJwk, "EdDSA"),
  })));
  const tokenVerifier = createServiceTokenVerifier({
    issuer: config.issuer,
    audience: config.audience,
    ttlSeconds: config.ttlSeconds,
    verificationKeys,
    stateStore,
  });
  return {
    config,
    stateStore,
    verifier: {
      async verify(assertion: string) {
        const identity = await tokenVerifier.verify(assertion);
        if (identity.scopes.length !== 1 || identity.scopes[0] !== "lead:create") {
          throw new AgentAssertionError("ASSERTION_INVALID", "Lead writer service scope must be exactly lead:create");
        }
        if (!(await stateStore.consume(identity.principalId, config.rateLimitPerMinute, 60))) {
          throw new LeadWriterRateLimitError();
        }
        return identity;
      },
    },
  };
}

let runtimePromise: ReturnType<typeof createLeadWriterAuthRuntime> | null = null;

export function getLeadWriterAuthRuntime() {
  runtimePromise ??= createLeadWriterAuthRuntime(loadLeadWriterAuthConfig());
  return runtimePromise;
}
