import { clearAgentAccountCookie } from "@/lib/agent/auth";

export const dynamic = "force-dynamic";

/** 退出 Agent 独立账号登录态（CRM 会话不受影响） */
export async function POST() {
  await clearAgentAccountCookie();
  return Response.json({ ok: true });
}
