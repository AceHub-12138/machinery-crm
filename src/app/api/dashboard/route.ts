import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import { CrmDashboardAccessError } from "@/modules/crm/dashboard/permissions";
import { getCrmDashboard } from "@/modules/crm/dashboard/service";

/** 兼容入口：旧客户端继续使用 /api/dashboard，统计逻辑与新路径完全共用。 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    return NextResponse.json(await getCrmDashboard(user, request.nextUrl.searchParams));
  } catch (error) {
    if (error instanceof CrmDashboardAccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    console.error("[dashboard.GET]", error);
    return NextResponse.json({ error: "工作台数据加载失败" }, { status: 500 });
  }
}
