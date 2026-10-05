import { SignJWT, jwtVerify } from "jose";

export const AGENT_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export type AgentAccountTokenPayload = {
  sub: string;
  username: string;
  displayName: string;
  sessionVersion: number;
};

type AgentAccountIdentity = {
  id: string;
  username: string;
  displayName: string;
  sessionVersion: number;
};

function agentTokenSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) throw new Error("AUTH_SECRET is required");
  return new TextEncoder().encode(secret);
}

/** 为 Agent 独立账号签发 30 天登录态（HS256，密钥复用 AUTH_SECRET） */
export async function signAgentAccountToken(account: AgentAccountIdentity) {
  return await new SignJWT({
    typ: "xiaochuan-agent",
    username: account.username,
    displayName: account.displayName,
    sessionVersion: account.sessionVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(account.id)
    .setIssuedAt()
    .setExpirationTime(`${AGENT_TOKEN_TTL_SECONDS}s`)
    .sign(agentTokenSecret());
}

export async function verifyAgentAccountToken(token: string): Promise<AgentAccountTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, agentTokenSecret());
    if (payload.typ !== "xiaochuan-agent" || typeof payload.sub !== "string") return null;
    if (typeof payload.username !== "string" || typeof payload.displayName !== "string") return null;
    if (!Number.isInteger(payload.sessionVersion) || Number(payload.sessionVersion) < 0) return null;
    return {
      sub: payload.sub,
      username: payload.username,
      displayName: payload.displayName,
      sessionVersion: Number(payload.sessionVersion),
    };
  } catch {
    return null;
  }
}

export function isAgentAccountTokenCurrent(
  payload: AgentAccountTokenPayload,
  account: { id: string; sessionVersion: number; isActive: boolean },
) {
  return account.isActive && payload.sub === account.id && payload.sessionVersion === account.sessionVersion;
}
