import { generateKeyPairSync } from "node:crypto";
import { decodeProtectedHeader, decodeJwt, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  AgentAssertionError,
  createAgentTokenService,
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

function createKeys(kid = "2026-07-a") {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { kid, privateKey, publicKey };
}

function createService(options?: {
  now?: () => Date;
  issuer?: string;
  audience?: string;
  keys?: ReturnType<typeof createKeys>[];
  activeKid?: string;
  store?: AgentJtiStore;
}) {
  const keys = options?.keys ?? [createKeys()];
  return createAgentTokenService({
    issuer: options?.issuer ?? "dachuanpro-crm",
    audience: options?.audience ?? "dachuanpro-agent-mcp",
    ttlSeconds: 600,
    activeKid: options?.activeKid ?? keys[0].kid,
    signingKeys: keys.map(({ kid, privateKey }) => ({ kid, key: privateKey })),
    verificationKeys: keys.map(({ kid, publicKey }) => ({ kid, key: publicKey })),
    stateStore: options?.store ?? createJtiStore(),
    now: options?.now,
  });
}

describe("agent user assertion", () => {
  it("issues an EdDSA token containing only the trusted user identity claims", async () => {
    const now = new Date("2026-07-17T08:00:00.000Z");
    const service = createService({ now: () => now });

    const issued = await service.issue("erp-user-1");
    const header = decodeProtectedHeader(issued.token);
    const claims = decodeJwt(issued.token);

    expect(header).toMatchObject({ alg: "EdDSA", kid: "2026-07-a", typ: "JWT" });
    expect(claims).toMatchObject({
      iss: "dachuanpro-crm",
      sub: "erp-user-1",
      aud: "dachuanpro-agent-mcp",
      iat: Math.floor(now.getTime() / 1000),
      nbf: Math.floor(now.getTime() / 1000),
      exp: Math.floor(now.getTime() / 1000) + 600,
      jti: issued.jti,
    });
    expect(claims).not.toHaveProperty("role");
    expect(claims).not.toHaveProperty("region");

    await expect(service.verify(issued.token)).resolves.toMatchObject({
      userId: "erp-user-1",
      jti: issued.jti,
    });
  });

  it("rejects expired, tampered, wrong issuer and wrong audience assertions", async () => {
    const keys = [createKeys()];
    const store = createJtiStore();
    const issuedAt = new Date("2026-07-17T08:00:00.000Z");
    const issuer = createService({ keys, store, now: () => issuedAt });
    const issued = await issuer.issue("erp-user-1");

    const expiredVerifier = createService({
      keys,
      store,
      now: () => new Date("2026-07-17T08:11:00.000Z"),
    });
    await expect(expiredVerifier.verify(issued.token)).rejects.toMatchObject({
      code: "ASSERTION_EXPIRED",
    });

    const parts = issued.token.split("");
    const signatureStart = issued.token.lastIndexOf(".") + 1;
    parts[signatureStart + 2] = parts[signatureStart + 2] === "A" ? "B" : "A";
    await expect(issuer.verify(parts.join(""))).rejects.toMatchObject({
      code: "ASSERTION_INVALID",
    });

    const wrongIssuer = createService({ keys, store, issuer: "not-dachuanpro" });
    await expect(wrongIssuer.verify(issued.token)).rejects.toMatchObject({
      code: "ASSERTION_ISSUER_INVALID",
    });

    const wrongAudience = createService({ keys, store, audience: "other-audience" });
    await expect(wrongAudience.verify(issued.token)).rejects.toMatchObject({
      code: "ASSERTION_AUDIENCE_INVALID",
    });
  });

  it("supports key rotation and rejects a revoked jti", async () => {
    const oldKey = createKeys("2026-06-old");
    const nextKey = createKeys("2026-07-next");
    const store = createJtiStore();
    const oldIssuer = createService({ keys: [oldKey], activeKid: oldKey.kid, store });
    const oldToken = await oldIssuer.issue("erp-user-1");
    const rotatingVerifier = createService({
      keys: [oldKey, nextKey],
      activeKid: nextKey.kid,
      store,
    });

    await expect(rotatingVerifier.verify(oldToken.token)).resolves.toMatchObject({
      userId: "erp-user-1",
    });

    await store.revoke(oldToken.jti, 600);
    await expect(rotatingVerifier.verify(oldToken.token)).rejects.toBeInstanceOf(AgentAssertionError);
    await expect(rotatingVerifier.verify(oldToken.token)).rejects.toMatchObject({
      code: "ASSERTION_REVOKED",
    });
  });

  it("refuses token lifetimes outside the 5 to 15 minute production window", () => {
    const keys = [createKeys()];
    const base = {
      issuer: "dachuanpro-crm",
      audience: "dachuanpro-agent-mcp",
      activeKid: keys[0].kid,
      signingKeys: [{ kid: keys[0].kid, key: keys[0].privateKey }],
      verificationKeys: [{ kid: keys[0].kid, key: keys[0].publicKey }],
      stateStore: createJtiStore(),
    };

    expect(() => createAgentTokenService({ ...base, ttlSeconds: 299 })).toThrow(/300/);
    expect(() => createAgentTokenService({ ...base, ttlSeconds: 901 })).toThrow(/900/);
  });

  it("rejects a signed token whose claims exceed the allowed lifetime", async () => {
    const keys = [createKeys()];
    const store = createJtiStore();
    const now = new Date("2026-07-17T08:00:00.000Z");
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const verifier = createService({ keys, store, now: () => now });
    await store.register("too-long-jti", 3600);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "EdDSA", kid: keys[0].kid, typ: "JWT" })
      .setIssuer("dachuanpro-crm")
      .setSubject("erp-user-1")
      .setAudience("dachuanpro-agent-mcp")
      .setIssuedAt(nowSeconds)
      .setNotBefore(nowSeconds)
      .setExpirationTime(nowSeconds + 3600)
      .setJti("too-long-jti")
      .sign(keys[0].privateKey);

    await expect(verifier.verify(token)).rejects.toMatchObject({
      code: "ASSERTION_INVALID",
    });
  });
});
