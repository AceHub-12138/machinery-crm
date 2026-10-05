import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessERP, isSuperAdmin } from "@/lib/permissions";
import { monthlyPlanNo, parsePlanMonth } from "@/lib/monthly-production-plans";
import { writeOperationLog } from "@/lib/sales-items";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canAccessERP(user)) return NextResponse.json({ error: "无权限访问 ERP" }, { status: 403 });
  return NextResponse.json(await prisma.monthlyProductionPlan.findMany({ include: { items: true }, orderBy: [{ planMonth: "desc" }, { version: "desc" }] }));
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isSuperAdmin(user)) return NextResponse.json({ error: "仅管理员可创建月度生产计划" }, { status: 403 });
  const body = await request.json();
  let month: Date;
  try { month = parsePlanMonth(body.planMonth); }
  catch { return NextResponse.json({ error: "计划月份格式无效" }, { status: 400 }); }
  if (!body.name || !Array.isArray(body.items) || !body.items.length) return NextResponse.json({ error: "计划月份、名称和明细为必填项" }, { status: 400 });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const latest = await tx.monthlyProductionPlan.findFirst({ where: { planMonth: month }, orderBy: { version: "desc" }, select: { version: true } });
      const version = (latest?.version || 0) + 1;
      const refs = await Promise.all(body.items.map(async (row: any) => {
        const quantity = new Prisma.Decimal(String(row.plannedQuantity || 0));
        const [product, bom] = await Promise.all([
          tx.product.findFirst({ where: { id: String(row.productId || ""), isActive: true, productType: "MAIN" }, select: { id: true, model: true } }),
          tx.bomHeader.findFirst({ where: { id: String(row.bomId || ""), productId: String(row.productId || ""), isActive: true }, select: { id: true, version: true } }),
        ]);
        const start = new Date(String(row.plannedStartDate || ""));
        const completion = new Date(String(row.plannedCompletionDate || ""));
        if (!product || !bom || !quantity.gt(0) || Number.isNaN(start.getTime()) || Number.isNaN(completion.getTime()) || start > completion) throw new Error("月度计划明细只能选择启用的主产品，并填写有效数量、日期和用料版本");
        return { productId: product.id, productModelSnapshot: product.model, plannedQuantity: quantity, plannedStartDate: start, plannedCompletionDate: completion, bomId: bom.id, bomVersionSnapshot: bom.version, remark: String(row.remark || "") || null };
      }));
      const created = await tx.monthlyProductionPlan.create({ data: { planNo: monthlyPlanNo(month, version), planMonth: month, name: String(body.name), description: String(body.description || "") || null, version, supersedesId: body.supersedesId || null, createdById: user.id, items: { create: refs } }, include: { items: true } });
      await writeOperationLog(tx, { userId: user.id, action: "CREATE_MONTHLY_PRODUCTION_PLAN", entityType: "MonthlyProductionPlan", entityId: created.id, afterData: created });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "创建失败" }, { status: 400 }); }
}
