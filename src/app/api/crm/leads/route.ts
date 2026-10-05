import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import { listHumanLeads } from "@/modules/crm/leads/read";
import { isDomainError } from "@/modules/shared/domain-error";

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    return NextResponse.json(await listHumanLeads(user, new URL(request.url).searchParams));
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    const diagnostic = error && typeof error === "object"
      ? { name: (error as { name?: unknown }).name, code: (error as { code?: unknown }).code }
      : { name: "UnknownError" };
    console.error("[crm.leads.GET]", diagnostic);
    return NextResponse.json({ error: "AI 线索列表加载失败" }, { status: 500 });
  }
}
