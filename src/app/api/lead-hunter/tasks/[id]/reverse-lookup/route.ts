import { NextRequest, NextResponse } from "next/server";
import { reverseLookupCandidates } from "@/lib/lead-hunter/admit";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { isDomainError } from "@/modules/shared/domain-error";

/** 勾选候选天眼查反查电话（人工模式），受每日上限护栏约束 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!isSuperAdmin(user)) return NextResponse.json({ error: "无权访问获客助手" }, { status: 403 });

    const { id } = await params;
    const body = await request.json().catch(() => null) as { candidateIds?: unknown } | null;
    const result = await reverseLookupCandidates(user, id, Array.isArray(body?.candidateIds) ? body!.candidateIds.map(String) : []);
    return NextResponse.json(result);
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[lead-hunter.reverse-lookup.POST]", error);
    return NextResponse.json({ error: "反查失败" }, { status: 500 });
  }
}
