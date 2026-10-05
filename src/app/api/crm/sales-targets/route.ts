import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/permissions";
import {
  listSalesTargets,
  parseSalesTargetMetric,
  parseSalesTargetPeriod,
  saveSalesTarget,
} from "@/modules/crm/sales-targets/service";
import { isDomainError } from "@/modules/shared/domain-error";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  try {
    const period = parseSalesTargetPeriod(request.nextUrl.searchParams);
    const rawMetric = request.nextUrl.searchParams.get("metric");
    const metric = rawMetric ? parseSalesTargetMetric(rawMetric) : undefined;
    return NextResponse.json(await listSalesTargets(user, period, metric));
  } catch (error) {
    if (isDomainError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[crm.sales-targets.GET]", error);
    return NextResponse.json({ error: "销售目标加载失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  try {
    const body = await request.json();
    return NextResponse.json(await saveSalesTarget(user, body));
  } catch (error) {
    if (isDomainError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    }
    console.error("[crm.sales-targets.POST]", error);
    return NextResponse.json({ error: "销售目标保存失败" }, { status: 500 });
  }
}
