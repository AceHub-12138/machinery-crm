import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { verifyCrmAgentAssertion } from "@/lib/agent-auth/crm-assertion";

const secret = "crm-agent-assertion-test-secret";

async function assertion(payload: { role?: string; issuedAt?: number; expiresAt?: number; secret?: string } = {}) {
  const issuedAt = payload.issuedAt ?? Math.floor(Date.now() / 1000);
  return new SignJWT({ role: payload.role ?? "SUPER_ADMIN" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("super-admin-1")
    .setIssuedAt(issuedAt)
    .setExpirationTime(payload.expiresAt ?? issuedAt + 600)
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(payload.secret ?? secret));
}

describe("CRM agent assertion", () => {
  it("accepts a short-lived HS256 SUPER_ADMIN bearer assertion", async () => {
    const token = await assertion();
    await expect(verifyCrmAgentAssertion(`Bearer ${token}`, secret)).resolves.toEqual({
      userId: "super-admin-1",
      role: "SUPER_ADMIN",
    });
  });

  it("rejects missing, forged, expired, overlong, and non-admin assertions", async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(verifyCrmAgentAssertion(null, secret)).resolves.toBeNull();
    await expect(verifyCrmAgentAssertion(`Bearer ${await assertion({ secret: "wrong-secret" })}`, secret)).resolves.toBeNull();
    await expect(verifyCrmAgentAssertion(`Bearer ${await assertion({ issuedAt: now - 700, expiresAt: now - 100 })}`, secret)).resolves.toBeNull();
    await expect(verifyCrmAgentAssertion(`Bearer ${await assertion({ issuedAt: now + 60, expiresAt: now + 660 })}`, secret)).resolves.toBeNull();
    await expect(verifyCrmAgentAssertion(`Bearer ${await assertion({ issuedAt: now, expiresAt: now + 601 })}`, secret)).resolves.toBeNull();
    await expect(verifyCrmAgentAssertion(`Bearer ${await assertion({ role: "SALES" })}`, secret)).resolves.toBeNull();
  });
});
