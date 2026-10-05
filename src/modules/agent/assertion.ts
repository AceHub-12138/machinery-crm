import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import type { SessionUser } from "@/lib/permissions";
import { DomainError } from "@/modules/shared/domain-error";

export const ASSERTION_TTL_SECONDS = 600;

/** 保持现有 Agent 身份桥接：仅超管、HS256、600 秒，且不记录 token。 */
export async function issueAgentAssertion(user: SessionUser, authSecret: string | undefined) {
  if (user.role !== "SUPER_ADMIN") throw new DomainError("无权限", 403);
  if (!authSecret) throw new DomainError("Agent 令牌签发服务未配置", 503);
  const issuedAt = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ASSERTION_TTL_SECONDS)
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(authSecret));
  return { token, expiresIn: ASSERTION_TTL_SECONDS };
}
