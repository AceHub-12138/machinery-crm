import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessERP, isSuperAdmin } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canAccessERP(user)) return NextResponse.json({ error: "无权限" }, { status: 403 });
  const { id } = await params;
  const plan = await prisma.monthlyProductionPlan.findUnique({ where: { id }, include: { items: { include: { materialRequirements: { include: { material: true } }, productionOrders: true } } } });
  return plan ? NextResponse.json(plan) : NextResponse.json({ error: "计划不存在" }, { status: 404 });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isSuperAdmin(user)) return NextResponse.json({ error: "无权限" }, { status: 403 });
  const { id } = await params;
  const body = await request.json();
  const plan = await prisma.monthlyProductionPlan.findUnique({ where: { id } });
  if (!plan || plan.status !== "DRAFT") return NextResponse.json({ error: "只有草稿计划可提交审核；已审核计划需创建新版本" }, { status: 409 });
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.monthlyProductionPlan.update({ where: { id }, data: { status: body.status === "PENDING_APPROVAL" ? "PENDING_APPROVAL" : "DRAFT", name: body.name || undefined, description: body.description === undefined ? undefined : body.description || null } });
    await writeOperationLog(tx, { userId: user.id, action: "UPDATE_MONTHLY_PRODUCTION_PLAN", entityType: "MonthlyProductionPlan", entityId: id, beforeData: plan, afterData: row });
    return row;
  });
  return NextResponse.json(updated);
}
