import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import { listInventory } from "@/modules/erp/inventory/service";
import { isDomainError } from "@/modules/shared/domain-error";

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    return NextResponse.json(await listInventory(user, new URL(request.url).searchParams));
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[erp.inventory.GET]", error);
    return NextResponse.json({ error: "库存台账加载失败" }, { status: 500 });
  }
}
