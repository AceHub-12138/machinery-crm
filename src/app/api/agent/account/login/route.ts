import bcryptjs from "bcryptjs";
import { prisma } from "@/lib/db";
import { setAgentAccountCookie } from "@/lib/agent/auth";
import { checkLoginRateLimit, recordLoginFailure, resetLoginRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Agent 独立账号登录（与 CRM 登录完全分离的名单）。
 * 约定：
 * - 用户名不在 Agent 名单 → 401 NOT_AGENT_ACCOUNT（前端才回退尝试 CRM 员工账号登录）；
 * - Agent 名单内密码错误 → 401 BAD_CREDENTIALS（不回退，避免同名账号串用）；
 * - 账号被停用 → 403 INACTIVE（直接提示，不回退）；
 * - 登录成功种 30 天 httpOnly Cookie。
 */
export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求格式无效" }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return Response.json({ error: "请输入账号和密码", code: "BAD_REQUEST" }, { status: 400 });
  }

  const account = await prisma.agentAccount.findUnique({ where: { username } });
  if (!account) {
    return Response.json({ error: "账号不在 Agent 名单", code: "NOT_AGENT_ACCOUNT" }, { status: 401 });
  }

  const rateLimitKey = `agent-account:${username.toLowerCase()}`;
  if (!checkLoginRateLimit(rateLimitKey).allowed) {
    return Response.json({ error: "尝试太频繁，请稍后再试", code: "RATE_LIMITED" }, { status: 429 });
  }
  if (!account.isActive) {
    return Response.json({ error: "账号已停用，请联系管理员", code: "INACTIVE" }, { status: 403 });
  }
  const passwordValid = await bcryptjs.compare(password, account.passwordHash);
  if (!passwordValid) {
    recordLoginFailure(rateLimitKey);
    return Response.json({ error: "账号或密码错误", code: "BAD_CREDENTIALS" }, { status: 401 });
  }

  resetLoginRateLimit(rateLimitKey);
  await setAgentAccountCookie(account);
  return Response.json({ ok: true, displayName: account.displayName });
}
