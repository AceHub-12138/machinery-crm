import { jwtVerify } from "jose";

export type CrmAgentAssertionIdentity = {
  userId: string;
  role: "SUPER_ADMIN";
};

const maximumLifetimeSeconds = 600;
const clockToleranceSeconds = 15;

function bearerToken(authorization: string | null) {
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || null;
}

/**
 * Verifies the short-lived CRM assertion that the browser sends to the MCP
 * gateway. This is deliberately separate from the Ed25519 assertion issued by
 * the gateway to FastGPT/MCP.
 */
export async function verifyCrmAgentAssertion(
  authorization: string | null,
  secret: string,
): Promise<CrmAgentAssertionIdentity | null> {
  const token = bearerToken(authorization);
  if (!token || !secret) return null;

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      clockTolerance: clockToleranceSeconds,
    });
    const userId = String(payload.sub || "").trim();
    const role = payload.role;
    const jti = String(payload.jti || "").trim();
    const issuedAt = payload.iat;
    const expiresAt = payload.exp;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      !userId
      || role !== "SUPER_ADMIN"
      || !jti
      || typeof issuedAt !== "number"
      || !Number.isInteger(issuedAt)
      || typeof expiresAt !== "number"
      || !Number.isInteger(expiresAt)
      || issuedAt > nowSeconds + clockToleranceSeconds
      || expiresAt <= issuedAt
      || expiresAt - issuedAt > maximumLifetimeSeconds
    ) {
      return null;
    }
    return { userId, role: "SUPER_ADMIN" };
  } catch {
    return null;
  }
}
