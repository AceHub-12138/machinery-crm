import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "无权访问获客助手" }, { status: 403 });
  return NextResponse.json({ error: "请到 AI 线索池反查" }, { status: 410 });
}
