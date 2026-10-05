import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isSuperAdmin(user)) return NextResponse.json({ error: "仅超级管理员可以查看工单变更审批" }, { status: 403 });
  const status = new URL(request.url).searchParams.get("status") || "";
  const items = await prisma.productionOrderChangeRequest.findMany({
    where: status && ["PENDING", "APPROVED", "REJECTED"].includes(status) ? { status: status as "PENDING" | "APPROVED" | "REJECTED" } : {},
    include: { productionOrder: { select: { id: true, orderNo: true, productModelSnapshot: true, version: true, isCurrent: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(items);
}
