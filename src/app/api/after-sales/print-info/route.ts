import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/permissions";
import { normalizeAfterSalesPrintInfo } from "@/lib/after-sales";
import { assertAfterSalesAccess } from "@/lib/after-sales-service";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    assertAfterSalesAccess(user);
    const setting = await prisma.systemSetting.findUnique({ where: { key: "printInfo" }, select: { value: true } });
    return NextResponse.json(normalizeAfterSalesPrintInfo(setting?.value).afterSalesPrintInfo);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "打印信息加载失败" }, { status: 400 });
  }
}
