import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import { getHumanLeadDetail } from "@/modules/crm/leads/read";
import { isDomainError } from "@/modules/shared/domain-error";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const { id } = await params;
    return NextResponse.json(await getHumanLeadDetail(user, id));
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    const diagnostic = error && typeof error === "object"
      ? { name: (error as { name?: unknown }).name, code: (error as { code?: unknown }).code }
      : { name: "UnknownError" };
    console.error("[crm.leads.detail.GET]", diagnostic);
    return NextResponse.json({ error: "AI 线索详情加载失败" }, { status: 500 });
  }
}
