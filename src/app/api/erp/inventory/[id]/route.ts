import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import { clearZeroInventoryRow } from "@/modules/erp/inventory/service";
import { isDomainError } from "@/modules/shared/domain-error";

/** 清除台账零库存结存行；只允许数量为 0 的行，历史单据不受影响。 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const { id } = await params;
    return NextResponse.json(await clearZeroInventoryRow(user, id));
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[erp.inventory.DELETE]", error);
    return NextResponse.json({ error: "库存行清除失败" }, { status: 500 });
  }
}
