import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import { listLeadAssignees } from "@/modules/crm/leads/assignment";
import { isDomainError } from "@/modules/shared/domain-error";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    return NextResponse.json(await listLeadAssignees(user));
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    const diagnostic = error && typeof error === "object"
      ? { name: (error as { name?: unknown }).name, code: (error as { code?: unknown }).code }
      : { name: "UnknownError" };
    console.error("[crm.leads.assignees.GET]", diagnostic);
    return NextResponse.json({ error: "Lead 候选负责人加载失败" }, { status: 500 });
  }
}
