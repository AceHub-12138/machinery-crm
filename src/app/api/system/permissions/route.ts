import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import { PERMISSION_ACTIONS, PERMISSION_MODULES, permissionMatrixForRole } from "@/modules/system/permissions";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "无权限查看权限矩阵" }, { status: 403 });
  return NextResponse.json({ modules: PERMISSION_MODULES, actions: PERMISSION_ACTIONS, roles: ["SUPER_ADMIN", "SALES", "FOREIGN_TRADE", "PURCHASE", "WAREHOUSE"].map((role) => ({ role, matrix: permissionMatrixForRole(role as typeof user.role) })) });
}
