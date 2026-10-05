import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import { issueAgentAssertion } from "@/modules/agent/assertion";
import { isDomainError } from "@/modules/shared/domain-error";

export async function POST() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    return NextResponse.json(await issueAgentAssertion(user, process.env.AUTH_SECRET));
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[agent.assertion.POST]", error);
    return NextResponse.json({ error: "Agent 令牌签发失败" }, { status: 500 });
  }
}
