import { importJWK, type JWK } from "jose";
import { createAgentTokenService } from "@/lib/agent-auth/token";
import {
  createRedisAgentAuthStateStore,
  type AgentAuthStateStore,
} from "@/lib/agent-auth/redis-state-store";

type Environment = Record<string, string | undefined>;

type AgentAuthKeyConfig = {
  kid: string;
  publicJwk: JWK;
  privateJwk?: JWK;
};

export type AgentAuthConfig = {
  crmAssertionSecret: string;
  issuer: string;
  audience: string;
  ttlSeconds: number;
  activeKid: string;
  keys: AgentAuthKeyConfig[];
  redisUrl: string;
  redisPrefix: string;
  fastGptChatUrl: string;
  fastGptApiKey: string;
  maxRequestBytes: number;
  rateLimitPerMinute: number;
  gatewayAllowedOrigins: string[];
};

function required(environment: Environment, name: string) {
  const value = String(environment[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integer(environment: Environment, name: string, fallback: number) {
  const value = Number(environment[name] || fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function parseKeys(value: string): AgentAuthKeyConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("AGENT_AUTH_KEYS_JSON must be valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("AGENT_AUTH_KEYS_JSON must contain at least one Ed25519 key");
  }
  const seen = new Set<string>();
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`Agent auth key ${index + 1} is invalid`);
    const input = entry as Record<string, unknown>;
    const kid = String(input.kid || "").trim();
    const publicJwk = input.publicJwk as JWK | undefined;
    const privateJwk = input.privateJwk as JWK | undefined;
    if (!kid || seen.has(kid)) throw new Error(`Agent auth key ${index + 1} has a missing or duplicate kid`);
    if (publicJwk?.kty !== "OKP" || publicJwk.crv !== "Ed25519" || typeof publicJwk.x !== "string") {
      throw new Error(`Agent auth key ${kid} requires an Ed25519 publicJwk`);
    }
    if (privateJwk && (
      privateJwk.kty !== "OKP"
      || privateJwk.crv !== "Ed25519"
      || typeof privateJwk.x !== "string"
      || typeof privateJwk.d !== "string"
    )) {
      throw new Error(`Agent auth key ${kid} has an invalid privateJwk`);
    }
    seen.add(kid);
    return { kid, publicJwk, ...(privateJwk ? { privateJwk } : {}) };
  });
}

function normalizedFastGptUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("AGENT_GATEWAY_FASTGPT_CHAT_URL must be an HTTP(S) URL without credentials or fragment");
  }
  return url.toString();
}

export function loadAgentAuthConfig(environment: Environment = process.env): AgentAuthConfig {
  const ttlSeconds = integer(environment, "AGENT_AUTH_TOKEN_TTL_SECONDS", 600);
  if (ttlSeconds < 300 || ttlSeconds > 900) {
    throw new Error("AGENT_AUTH_TOKEN_TTL_SECONDS must be between 300 and 900");
  }
  const activeKid = required(environment, "AGENT_AUTH_ACTIVE_KID");
  const keys = parseKeys(required(environment, "AGENT_AUTH_KEYS_JSON"));
  if (!keys.some((entry) => entry.kid === activeKid && entry.privateJwk)) {
    throw new Error("AGENT_AUTH_ACTIVE_KID must reference a key with privateJwk");
  }
  return {
    crmAssertionSecret: required(environment, "CRM_AGENT_ASSERTION_SECRET"),
    issuer: required(environment, "AGENT_AUTH_ISSUER"),
    audience: required(environment, "AGENT_AUTH_AUDIENCE"),
    ttlSeconds,
    activeKid,
    keys,
    redisUrl: required(environment, "AGENT_AUTH_REDIS_URL"),
    redisPrefix: String(environment.AGENT_AUTH_REDIS_PREFIX || "dachuan:agent-auth").trim(),
    fastGptChatUrl: normalizedFastGptUrl(required(environment, "AGENT_GATEWAY_FASTGPT_CHAT_URL")),
    fastGptApiKey: required(environment, "AGENT_GATEWAY_FASTGPT_API_KEY"),
    maxRequestBytes: integer(environment, "AGENT_GATEWAY_MAX_REQUEST_BYTES", 1_048_576),
    rateLimitPerMinute: integer(environment, "AGENT_GATEWAY_RATE_LIMIT_PER_MINUTE", 10),
    gatewayAllowedOrigins: required(environment, "AGENT_GATEWAY_ALLOWED_ORIGINS")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

export async function createAgentAuthRuntime(
  config: AgentAuthConfig,
  stateStore: AgentAuthStateStore = createRedisAgentAuthStateStore(config.redisUrl, config.redisPrefix),
) {
  const signingKeys = await Promise.all(config.keys
    .filter((entry): entry is AgentAuthKeyConfig & { privateJwk: JWK } => Boolean(entry.privateJwk))
    .map(async (entry) => ({ kid: entry.kid, key: await importJWK(entry.privateJwk, "EdDSA") })));
  const verificationKeys = await Promise.all(config.keys.map(async (entry) => ({
    kid: entry.kid,
    key: await importJWK(entry.publicJwk, "EdDSA"),
  })));
  const tokenService = createAgentTokenService({
    issuer: config.issuer,
    audience: config.audience,
    ttlSeconds: config.ttlSeconds,
    activeKid: config.activeKid,
    signingKeys,
    verificationKeys,
    stateStore,
  });
  return { config, tokenService, stateStore };
}
