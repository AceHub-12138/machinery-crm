import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, canSeeAllData, customerIsolationWhere } from "@/lib/permissions";
import { assertAfterSalesAccess } from "@/lib/after-sales-service";
import { afterSalesOrderIsOverdue, afterSalesOrderWhere, normalizeAfterSalesReminderConfig } from "@/lib/after-sales";

function countBy<T>(rows: T[], keyFor: (row: T) => string | null | undefined) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyFor(row);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, "zh-CN"));
}

function monthOf(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(date).replace("-", "-");
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    assertAfterSalesAccess(user);
    const [rows, reminderSetting] = await Promise.all([prisma.afterSalesOrder.findMany({
      where: afterSalesOrderWhere(user),
      select: { orderType: true, urgency: true, status: true, assigneeNames: true, dispatchDate: true, createdAt: true, equipmentModelSnapshot: true, problemCategory: true, parts: { select: { partName: true } } },
    }), prisma.systemSetting.findUnique({ where: { key: "reminders" }, select: { value: true } })]);
    const reminderConfig = normalizeAfterSalesReminderConfig(reminderSetting?.value).afterSalesAlertDays;
    const models = [...new Set(rows.map((row) => row.equipmentModelSnapshot).filter(Boolean))];
    const contracts = models.length ? await prisma.contract.findMany({
      where: { deletedAt: null, equipmentModel: { in: models }, customer: canSeeAllData(user) ? {} : customerIsolationWhere(user) },
      select: { equipmentModel: true, items: { select: { productModelSnapshot: true, quantity: true } } },
    }) : [];
    const deviceCountByModel = new Map<string, number>();
    for (const contract of contracts) {
      const matchingItems = contract.items.filter((item) => item.productModelSnapshot === contract.equipmentModel);
      const quantity = matchingItems.reduce((sum, item) => sum + item.quantity, 0);
      deviceCountByModel.set(contract.equipmentModel, (deviceCountByModel.get(contract.equipmentModel) || 0) + (quantity || 1));
    }
    const modelPartCounts = new Map<string, number>();
    const modelProblemCounts = new Map<string, number>();
    for (const row of rows) {
      for (const part of row.parts) {
        const key = `${row.equipmentModelSnapshot}\u0000${part.partName}`;
        modelPartCounts.set(key, (modelPartCounts.get(key) || 0) + 1);
      }
      if (row.problemCategory) {
        const key = `${row.equipmentModelSnapshot}\u0000${row.problemCategory}`;
        modelProblemCounts.set(key, (modelProblemCounts.get(key) || 0) + 1);
      }
    }
    const modelOrderCounts = countBy(rows, (row) => row.equipmentModelSnapshot);
    const now = new Date();
    const weekStart = new Date(now); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const inProgress = rows.filter((row) => ["PENDING_DISPATCH", "DISPATCHED", "IN_PROGRESS"].includes(row.status)).length;
    const overdue = rows.filter((row) => afterSalesOrderIsOverdue({ dispatchDate: row.dispatchDate, orderType: row.orderType as any, urgency: row.urgency as any, status: row.status as any }, now, reminderConfig)).length;
    return NextResponse.json({
      summary: { weekNew: rows.filter((row) => row.createdAt >= weekStart).length, inProgress, overdue },
      byType: countBy(rows, (row) => row.orderType),
      byStatus: countBy(rows, (row) => row.status),
      byAssignee: countBy(rows.flatMap((row) => row.assigneeNames.split(/[、,，;；]/).map((name) => name.trim()).filter(Boolean)), (name) => name),
      monthlyTrend: countBy(rows, (row) => monthOf(row.dispatchDate)),
      modelPartRanking: [...modelPartCounts.entries()].map(([key, count]) => { const [model, partName] = key.split("\u0000"); return { model, partName, count }; }).sort((left, right) => right.count - left.count || left.model.localeCompare(right.model, "zh-CN")),
      modelProblemDistribution: [...modelProblemCounts.entries()].map(([key, count]) => { const [model, problemCategory] = key.split("\u0000"); return { model, problemCategory, count }; }).sort((left, right) => right.count - left.count || left.model.localeCompare(right.model, "zh-CN")),
      failureRates: modelOrderCounts.map(({ key: model, count: orderCount }) => ({ model, orderCount, deviceCount: deviceCountByModel.get(model) || 0, rate: (deviceCountByModel.get(model) || 0) > 0 ? orderCount / (deviceCountByModel.get(model) || 0) : null })).sort((left, right) => (right.rate ?? -1) - (left.rate ?? -1)),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "售后统计加载失败" }, { status: 400 });
  }
}
