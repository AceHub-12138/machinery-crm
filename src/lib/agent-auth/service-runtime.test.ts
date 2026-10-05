import { generateKeyPairSync } from "node:crypto";
import { exportJWK } from "jose";
import { describe, expect, it } from "vitest";
import { createServiceTokenService, type AgentJtiStore } from "@/lib/agent-auth/token";
import {
  createLeadWriterAuthRuntime,
  LeadWriterRateLimitError,
  loadLeadWriterAuthConfig,
} from "@/lib/agent-auth/service-runtime";
import type { AgentAuthStateStore } from "@/lib/agent-auth/redis-state-store";

function stateStore(): AgentAuthStateStore {
  const active = new Set<string>();
  let remaining = 1;
  return {
    async register(jti) { active.add(jti); },
    async isActive(jti) { return active.has(jti); },
    async revoke(jti) { active.delete(jti); },
    async consume() { remaining -= 1; return remaining >= 0; },
    async close() {},
  };
}

describe("Lead writer auth runtime", () => {
  it("loads public-key-only service verification settings with a distinct audience", () => {
    const config = loadLeadWriterAuthConfig({
      AGENT_AUTH_AUDIENCE: "dachuanpro-human-mcp",
      AGENT_AUTH_PUBLIC_KEYS_JSON: JSON.stringify([{
        kid: "human-2026-08",
        publicJwk: { kty: "OKP", crv: "Ed25519", x: "h".repeat(43) },
      }]),
      LEAD_WRITER_AUTH_ISSUER: "dachuanpro-lead-ingestor",
      LEAD_WRITER_AUTH_AUDIENCE: "dachuanpro-lead-command",
      LEAD_WRITER_AUTH_TOKEN_TTL_SECONDS: "300",
      LEAD_WRITER_AUTH_KEYS_JSON: JSON.stringify([{
        kid: "lead-writer-2026-08",
        publicJwk: { kty: "OKP", crv: "Ed25519", x: "a".repeat(43) },
      }]),
      LEAD_WRITER_AUTH_REDIS_URL: "redis://redis:6379/2",
      LEAD_WRITER_AUTH_RATE_LIMIT_PER_MINUTE: "30",
    });

    expect(config).toMatchObject({
      issuer: "dachuanpro-lead-ingestor",
      audience: "dachuanpro-lead-command",
      ttlSeconds: 300,
      redisPrefix: "dachuan:lead-writer-auth",
      rateLimitPerMinute: 30,
    });
    expect(config.keys[0]).not.toHaveProperty("privateJwk");
  });

  it("fails closed when the human assertion audience comparison is omitted", () => {
    expect(() => loadLeadWriterAuthConfig({
      AGENT_AUTH_PUBLIC_KEYS_JSON: JSON.stringify([{
        kid: "human-2026-08",
        publicJwk: { kty: "OKP", crv: "Ed25519", x: "h".repeat(43) },
      }]),
      LEAD_WRITER_AUTH_ISSUER: "dachuanpro-lead-ingestor",
      LEAD_WRITER_AUTH_AUDIENCE: "dachuanpro-lead-command",
      LEAD_WRITER_AUTH_KEYS_JSON: JSON.stringify([{
        kid: "lead-writer-2026-08",
        publicJwk: { kty: "OKP", crv: "Ed25519", x: "a".repeat(43) },
      }]),
      LEAD_WRITER_AUTH_REDIS_URL: "redis://redis:6379/2",
    })).toThrow(/AGENT_AUTH_AUDIENCE is required/);
  });

  it("rejects reuse of any human assertion public key", () => {
    const sharedPublicJwk = { kty: "OKP", crv: "Ed25519", x: "s".repeat(43) };
    expect(() => loadLeadWriterAuthConfig({
      AGENT_AUTH_AUDIENCE: "dachuanpro-human-mcp",
      AGENT_AUTH_PUBLIC_KEYS_JSON: JSON.stringify([{ kid: "human-key", publicJwk: sharedPublicJwk }]),
      LEAD_WRITER_AUTH_ISSUER: "dachuanpro-lead-ingestor",
      LEAD_WRITER_AUTH_AUDIENCE: "dachuanpro-lead-command",
      LEAD_WRITER_AUTH_KEYS_JSON: JSON.stringify([{ kid: "renamed-service-key", publicJwk: sharedPublicJwk }]),
      LEAD_WRITER_AUTH_REDIS_URL: "redis://redis:6379/2",
    })).toThrow(/must not reuse an AGENT_AUTH_PUBLIC_KEYS_JSON key/);
  });

  it("rejects an Ed25519 private parameter hidden inside publicJwk", () => {
    expect(() => loadLeadWriterAuthConfig({
      AGENT_AUTH_AUDIENCE: "dachuanpro-human-mcp",
      AGENT_AUTH_PUBLIC_KEYS_JSON: JSON.stringify([{
        kid: "human-key",
        publicJwk: { kty: "OKP", crv: "Ed25519", x: "h".repeat(43) },
      }]),
      LEAD_WRITER_AUTH_ISSUER: "dachuanpro-lead-ingestor",
      LEAD_WRITER_AUTH_AUDIENCE: "dachuanpro-lead-command",
      LEAD_WRITER_AUTH_KEYS_JSON: JSON.stringify([{
        kid: "lead-writer-key",
        publicJwk: { kty: "OKP", crv: "Ed25519", x: "s".repeat(43), d: "p".repeat(43) },
      }]),
      LEAD_WRITER_AUTH_REDIS_URL: "redis://redis:6379/2",
    })).toThrow(/must contain public keys only/);
  });

  it("enforces an independent per-service rate limit after cryptographic verification", async () => {
    const keys = generateKeyPairSync("ed25519");
    const publicJwk = await exportJWK(keys.publicKey);
    const store = stateStore();
    const issuer = createServiceTokenService({
      issuer: "dachuanpro-lead-ingestor",
      audience: "dachuanpro-lead-command",
      ttlSeconds: 300,
      activeKid: "lead-writer-2026-08",
      signingKeys: [{ kid: "lead-writer-2026-08", key: keys.privateKey }],
      verificationKeys: [{ kid: "lead-writer-2026-08", key: keys.publicKey }],
      stateStore: store as AgentJtiStore,
    });
    const runtime = await createLeadWriterAuthRuntime({
      issuer: "dachuanpro-lead-ingestor",
      audience: "dachuanpro-lead-command",
      ttlSeconds: 300,
      keys: [{ kid: "lead-writer-2026-08", publicJwk }],
      redisUrl: "redis://unused",
      redisPrefix: "test:lead-writer",
      rateLimitPerMinute: 1,
    }, store);
    const issued = await issuer.issue("ai-lead-ingestor", ["lead:create"]);

    await expect(runtime.verifier.verify(issued.token)).resolves.toMatchObject({ principalId: "ai-lead-ingestor" });
    await expect(runtime.verifier.verify(issued.token)).rejects.toBeInstanceOf(LeadWriterRateLimitError);
  });

  it("rejects a service assertion carrying any scope beyond lead:create", async () => {
    const keys = generateKeyPairSync("ed25519");
    const publicJwk = await exportJWK(keys.publicKey);
    const store = stateStore();
    const issuer = createServiceTokenService({
      issuer: "dachuanpro-lead-ingestor",
      audience: "dachuanpro-lead-command",
      ttlSeconds: 300,
      activeKid: "lead-writer-2026-08",
      signingKeys: [{ kid: "lead-writer-2026-08", key: keys.privateKey }],
      verificationKeys: [{ kid: "lead-writer-2026-08", key: keys.publicKey }],
      stateStore: store as AgentJtiStore,
    });
    const runtime = await createLeadWriterAuthRuntime({
      issuer: "dachuanpro-lead-ingestor",
      audience: "dachuanpro-lead-command",
      ttlSeconds: 300,
      keys: [{ kid: "lead-writer-2026-08", publicJwk }],
      redisUrl: "redis://unused",
      redisPrefix: "test:lead-writer",
      rateLimitPerMinute: 30,
    }, store);
    const issued = await issuer.issue("ai-lead-ingestor", ["lead:create", "customer:create"]);

    await expect(runtime.verifier.verify(issued.token)).rejects.toMatchObject({ code: "ASSERTION_INVALID" });
  });
});
