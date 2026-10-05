import { generateKeyPairSync } from "node:crypto";
import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import {
  createAgentTokenService,
  createServiceTokenVerifier,
  createServiceTokenService,
  type AgentJtiStore,
} from "@/lib/agent-auth/token";

function createJtiStore(): AgentJtiStore {
  const active = new Set<string>();
  return {
    async register(jti) {
      active.add(jti);
    },
    async isActive(jti) {
      return active.has(jti);
    },
    async revoke(jti) {
      active.delete(jti);
    },
  };
}

function createService() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createServiceTokenService({
    issuer: "dachuanpro-lead-ingestor",
    audience: "dachuanpro-mcp-lead-command",
    ttlSeconds: 300,
    activeKid: "lead-writer-2026-08",
    signingKeys: [{ kid: "lead-writer-2026-08", key: privateKey }],
    verificationKeys: [{ kid: "lead-writer-2026-08", key: publicKey }],
    stateStore: createJtiStore(),
  });
}

describe("lead writer service assertion", () => {
  it("issues and verifies a SERVICE principal with a stable id and minimal scope", async () => {
    const service = createService();
    const issued = await service.issue("ai-lead-ingestor", ["lead:create"]);

    expect(decodeJwt(issued.token)).toMatchObject({
      sub: "ai-lead-ingestor",
      aud: "dachuanpro-mcp-lead-command",
      principalType: "SERVICE",
      scope: ["lead:create"],
    });
    expect(decodeJwt(issued.token)).not.toHaveProperty("role");
    await expect(service.verify(issued.token)).resolves.toMatchObject({
      principalType: "SERVICE",
      principalId: "ai-lead-ingestor",
      scopes: ["lead:create"],
      jti: issued.jti,
    });
  });

  it("rejects a human-shaped assertion even when it is signed for the service audience", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const store = createJtiStore();
    const humanIssuer = createAgentTokenService({
      issuer: "dachuanpro-lead-ingestor",
      audience: "dachuanpro-mcp-lead-command",
      ttlSeconds: 300,
      activeKid: "shared-test-key",
      signingKeys: [{ kid: "shared-test-key", key: privateKey }],
      verificationKeys: [{ kid: "shared-test-key", key: publicKey }],
      stateStore: store,
    });
    const verifier = createServiceTokenVerifier({
      issuer: "dachuanpro-lead-ingestor",
      audience: "dachuanpro-mcp-lead-command",
      ttlSeconds: 300,
      verificationKeys: [{ kid: "shared-test-key", key: publicKey }],
      stateStore: store,
    });
    const humanToken = await humanIssuer.issue("human-super-admin-id");

    await expect(verifier.verify(humanToken.token)).rejects.toMatchObject({ code: "ASSERTION_INVALID" });
  });

  it("verifies with public keys only so the MCP runtime never needs the service private key", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const store = createJtiStore();
    const issuer = createServiceTokenService({
      issuer: "dachuanpro-lead-ingestor",
      audience: "dachuanpro-mcp-lead-command",
      ttlSeconds: 300,
      activeKid: "lead-writer-2026-08",
      signingKeys: [{ kid: "lead-writer-2026-08", key: privateKey }],
      verificationKeys: [{ kid: "lead-writer-2026-08", key: publicKey }],
      stateStore: store,
    });
    const verifier = createServiceTokenVerifier({
      issuer: "dachuanpro-lead-ingestor",
      audience: "dachuanpro-mcp-lead-command",
      ttlSeconds: 300,
      verificationKeys: [{ kid: "lead-writer-2026-08", key: publicKey }],
      stateStore: store,
    });
    const issued = await issuer.issue("ai-lead-ingestor", ["lead:create"]);

    await expect(verifier.verify(issued.token)).resolves.toMatchObject({
      principalType: "SERVICE",
      principalId: "ai-lead-ingestor",
      scopes: ["lead:create"],
    });
  });
});
