import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { approveMonthlyProductionPlan } from "@/lib/monthly-production-plans";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isSuperAdmin(user)) return NextResponse.json({ error: "仅管理员可审核" }, { status: 403 });
  const { id } = await params;
  try { return NextResponse.json(await prisma.$transaction((tx) => approveMonthlyProductionPlan(tx, { planId: id, approvedById: user.id }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "审核失败" }, { status: 409 }); }
}
