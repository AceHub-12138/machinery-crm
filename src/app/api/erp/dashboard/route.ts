import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import { ErpDashboardAccessError } from "@/modules/erp/dashboard/permissions";
import { getErpDashboard } from "@/modules/erp/dashboard/service";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try { return NextResponse.json(await getErpDashboard(user)); }
  catch (error) { if (error instanceof ErpDashboardAccessError) return NextResponse.json({ error: error.message }, { status: 403 }); console.error("[erp.dashboard.GET]", error); return NextResponse.json({ error: "ERP工作台数据加载失败" }, { status: 500 }); }
}
