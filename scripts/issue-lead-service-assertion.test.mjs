import { decodeJwt, decodeProtectedHeader, exportJWK, generateKeyPair, jwtVerify } from "jose";
import { describe, expect, it, vi } from "vitest";
import {
  createLeadServiceAssertionIssuer,
  loadLeadServiceAssertionConfig,
} from "./issue-lead-service-assertion.mjs";

async function fixture(overrides = {}) {
  const serviceKeys = await generateKeyPair("EdDSA", { extractable: true });
  const humanKeys = await generateKeyPair("EdDSA", { extractable: true });
  const servicePrivateJwk = await exportJWK(serviceKeys.privateKey);
  const servicePublicJwk = await exportJWK(serviceKeys.publicKey);
  const humanPublicJwk = await exportJWK(humanKeys.publicKey);
  const environment = {
    LEAD_SERVICE_ASSERTION_ISSUER: "https://fastgpt.internal",
    LEAD_SERVICE_ASSERTION_AUDIENCE: "dachuanpro-lead-writer",
    LEAD_SERVICE_ASSERTION_TOKEN_TTL_SECONDS: "300",
    LEAD_SERVICE_ASSERTION_ACTIVE_KID: "lead-service-2026-08",
    LEAD_SERVICE_ASSERTION_PRIVATE_JWK_JSON: JSON.stringify(servicePrivateJwk),
    LEAD_SERVICE_ASSERTION_PRINCIPAL_ID: "fastgpt-lead-agent",
    LEAD_SERVICE_ASSERTION_REDIS_URL: "redis://lead-assertion.invalid:6379",
    LEAD_SERVICE_ASSERTION_REDIS_PREFIX: "dachuan:lead-service-assertion",
    LEAD_SERVICE_ASSERTION_RATE_LIMIT_PER_MINUTE: "30",
    AGENT_AUTH_AUDIENCE: "dachuanpro-human-agent",
    AGENT_AUTH_REDIS_PREFIX: "dachuan:human-agent-auth",
    AGENT_AUTH_PUBLIC_KEYS_JSON: JSON.stringify([{ kid: "human-1", publicJwk: humanPublicJwk }]),
    ...overrides,
  };
  return { environment, serviceKeys, servicePrivateJwk, servicePublicJwk };
}

describe("Lead SERVICE assertion issuer", () => {
  it("issues only a short lead:create assertion and registers its jti", async () => {
    const { environment, serviceKeys } = await fixture();
    const stateStore = {
      consume: vi.fn().mockResolvedValue(true),
      register: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const issuer = await createLeadServiceAssertionIssuer(
      loadLeadServiceAssertionConfig(environment),
      {
        stateStore,
        now: () => new Date("2026-08-17T00:00:00.000Z"),
        createJti: () => "lead-service-jti-0001",
      },
    );

    const result = await issuer.issue();
    const verified = await jwtVerify(result.token, serviceKeys.publicKey, {
      algorithms: ["EdDSA"],
      issuer: environment.LEAD_SERVICE_ASSERTION_ISSUER,
      audience: environment.LEAD_SERVICE_ASSERTION_AUDIENCE,
      currentDate: new Date("2026-08-17T00:00:01.000Z"),
    });

    expect(decodeProtectedHeader(result.token)).toMatchObject({
      alg: "EdDSA",
      kid: environment.LEAD_SERVICE_ASSERTION_ACTIVE_KID,
      typ: "JWT",
    });
    expect(verified.payload).toMatchObject({
      principalType: "SERVICE",
      sub: environment.LEAD_SERVICE_ASSERTION_PRINCIPAL_ID,
      scope: ["lead:create"],
      jti: "lead-service-jti-0001",
    });
    expect(verified.payload.exp - verified.payload.iat).toBe(300);
    expect(stateStore.consume).toHaveBeenCalledWith(environment.LEAD_SERVICE_ASSERTION_PRINCIPAL_ID, 30, 60);
    expect(stateStore.register).toHaveBeenCalledWith("lead-service-jti-0001", 300);
  });

  it("rejects shared audience, signing key, or Redis namespace", async () => {
    const { environment, servicePublicJwk } = await fixture();

    expect(() => loadLeadServiceAssertionConfig({
      ...environment,
      LEAD_SERVICE_ASSERTION_AUDIENCE: environment.AGENT_AUTH_AUDIENCE,
    })).toThrow(/audience must differ/i);
    expect(() => loadLeadServiceAssertionConfig({
      ...environment,
      AGENT_AUTH_PUBLIC_KEYS_JSON: JSON.stringify([{ kid: "human-1", publicJwk: servicePublicJwk }]),
    })).toThrow(/must not reuse/i);
    expect(() => loadLeadServiceAssertionConfig({
      ...environment,
      LEAD_SERVICE_ASSERTION_REDIS_PREFIX: environment.AGENT_AUTH_REDIS_PREFIX,
    })).toThrow(/Redis prefix must differ/i);
  });

  it("rejects simultaneous inline and file private key sources", async () => {
    const { environment } = await fixture();
    expect(() => loadLeadServiceAssertionConfig({
      ...environment,
      LEAD_SERVICE_ASSERTION_PRIVATE_JWK_FILE: "private.jwk",
    })).toThrow(/exactly one/i);
  });

  it("rejects TTL outside 300 to 900 seconds and does not issue when rate limited", async () => {
    const { environment } = await fixture();
    expect(() => loadLeadServiceAssertionConfig({
      ...environment,
      LEAD_SERVICE_ASSERTION_TOKEN_TTL_SECONDS: "299",
    })).toThrow(/between 300 and 900/i);

    const issuer = await createLeadServiceAssertionIssuer(
      loadLeadServiceAssertionConfig(environment),
      {
        stateStore: {
          consume: vi.fn().mockResolvedValue(false),
          register: vi.fn(),
          close: vi.fn(),
        },
      },
    );
    await expect(issuer.issue()).rejects.toThrow(/rate limit exceeded/i);
  });

  it("never accepts caller supplied scope or principal claims", async () => {
    const { environment } = await fixture();
    const config = loadLeadServiceAssertionConfig(environment);
    expect(config).not.toHaveProperty("scope");
    expect(decodeJwt).toBeTypeOf("function");
  });
});
