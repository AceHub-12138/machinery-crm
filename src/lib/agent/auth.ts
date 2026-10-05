import { cookies } from "next/headers";
import { auth as nextAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  AGENT_TOKEN_TTL_SECONDS,
  isAgentAccountTokenCurrent,
  signAgentAccountToken,
  verifyAgentAccountToken,
} from "@/lib/agent/account-token";
import type { McpUser } from "@/lib/mcp/application";
import type { SessionUser } from "@/lib/customer-permissions";
import type { AgentAccount } from "@prisma/client";

/**
 * 小川双身份识别。
 *
 * - CRM 员工：复用 NextAuth 会话（平台内跳转免登录），享有其角色对应的数据工具；
 * - Agent 独立账号：独立 JWT Cookie（与 NextAuth 完全分离，CRM 认证代码零改动），
 *   只能使用 Agent 平台对话 + 公司知识库 + 外部工具，业务工具按 AGENT_ACCOUNT 角色恒拒。
 *
 * 两套名单互不相通：Agent 账号不在 users 表，天然无 CRM/ERP 数据权限。
 */

export const AGENT_ACCOUNT_COOKIE = "xiaochuan_agent_token";

export type XiaochuanViewer =
  | { kind: "crm"; user: SessionUser }
  | { kind: "agent-account"; account: AgentAccount };

export function agentAccountCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    // 与 CRM 会话同规则：AUTH_COOKIE_DOMAIN 设置后跨子域共享 Agent 登录态
    domain: process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined,
    path: "/",
    maxAge: AGENT_TOKEN_TTL_SECONDS,
  };
}

/** Agent 独立账号登录成功后种 Cookie（route handler 里使用） */
export async function setAgentAccountCookie(account: Pick<AgentAccount, "id" | "username" | "displayName" | "sessionVersion">) {
  const token = await signAgentAccountToken(account);
  const store = await cookies();
  store.set(AGENT_ACCOUNT_COOKIE, token, agentAccountCookieOptions());
}

export async function clearAgentAccountCookie() {
  const store = await cookies();
  store.set(AGENT_ACCOUNT_COOKIE, "", { ...agentAccountCookieOptions(), maxAge: 0 });
}

/**
 * 识别当前访问者身份：NextAuth 会话优先（CRM 员工），其次 Agent 独立账号 Cookie。
 * 都没有时返回 null（调用方渲染登录页 / 返回 401）。
 */
export async function getXiaochuanViewer(): Promise<XiaochuanViewer | null> {
  const session = await nextAuth();
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id;
  if (sessionUserId) {
    const user = await prisma.user.findUnique({
      where: { id: sessionUserId },
      select: {
        id: true,
        role: true,
        region: true,
        territories: true,
        viewScope: true,
        name: true,
        email: true,
        isActive: true,
      },
    });
    if (user && user.isActive) {
      return {
        kind: "crm",
        user: {
          id: user.id,
          role: user.role as SessionUser["role"],
          region: user.region,
          territories: JSON.parse(JSON.stringify(user.territories ?? [])),
          viewScope: user.viewScope || "TERRITORY",
          name: user.name,
          email: user.email,
        },
      };
    }
    // CRM 会话失效（被停用等）不直接放行，继续尝试 Agent 账号 Cookie 没有意义——直接返回 null，
    // 避免同一浏览器两套身份串用。
    return null;
  }

  const store = await cookies();
  const token = store.get(AGENT_ACCOUNT_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyAgentAccountToken(token);
  if (!payload) return null;
  const account = await prisma.agentAccount.findUnique({ where: { id: payload.sub } });
  if (!account || !isAgentAccountTokenCurrent(payload, account)) return null;
  return { kind: "agent-account", account };
}

/** Agent 独立账号的引擎用户形态：AGENT_ACCOUNT 角色使业务工具全量拒绝，仅知识工具可用 */
export function agentAccountToMcpUser(account: AgentAccount): McpUser {
  return {
    id: account.id,
    isActive: account.isActive,
    name: account.displayName,
    email: account.username,
    role: "AGENT_ACCOUNT",
    region: "",
    territories: [],
    viewScope: "AGENT_ONLY",
  };
}

/** 前端展示用的轻量身份信息（传给 XiaochuanChat） */
export type XiaochuanViewerView = {
  kind: "crm" | "agent-account";
  id: string;
  name: string;
  email: string;
};

export function toViewerView(viewer: XiaochuanViewer): XiaochuanViewerView {
  if (viewer.kind === "crm") {
    return { kind: "crm", id: viewer.user.id, name: viewer.user.name ?? "", email: viewer.user.email ?? "" };
  }
  return { kind: "agent-account", id: viewer.account.id, name: viewer.account.displayName, email: viewer.account.username };
}
