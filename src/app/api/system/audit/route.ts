import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import { listOperationLogs } from "@/modules/system/audit/service";
import { isDomainError } from "@/modules/shared/domain-error";

/** 推荐系统审计入口，与 /api/operation-logs 共享服务及当前响应形状。 */
export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    return NextResponse.json(await listOperationLogs(user, new URL(request.url).searchParams));
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[system.audit.GET]", error);
    return NextResponse.json({ error: "操作日志加载失败" }, { status: 500 });
  }
}
