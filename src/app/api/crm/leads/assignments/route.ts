import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import { assignHumanLeads } from "@/modules/crm/leads/assignment";
import { isDomainError } from "@/modules/shared/domain-error";

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    return NextResponse.json(await assignHumanLeads(user, await request.json()));
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求 JSON 不合法" }, { status: 400 });
    const diagnostic = error && typeof error === "object"
      ? { name: (error as { name?: unknown }).name, code: (error as { code?: unknown }).code }
      : { name: "UnknownError" };
    console.error("[crm.leads.assignments.POST]", diagnostic);
    return NextResponse.json({ error: "Lead 分配失败" }, { status: 500 });
  }
}
