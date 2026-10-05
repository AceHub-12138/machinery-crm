import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canManagePurchaseOrders, getSessionUser } from "@/lib/permissions";
import { normalizeMonthlySparePartsForecast } from "@/lib/monthly-spare-parts-forecast";
import { upsertPurchaseDemandForSource } from "@/lib/procurement-planning";
import { writeOperationLog } from "@/lib/sales-items";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canManagePurchaseOrders(user)) return NextResponse.json({ error: "无权限创建月度备件预测" }, { status: 403 });

  try {
    const body = await request.json();
    const input = normalizeMonthlySparePartsForecast(body);
    const requestKey = String(body.requestKey || "").trim();
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(requestKey)) throw new Error("月度备件预测缺少有效的防重复标识，请刷新页面后重试");
    const sourceRecordId = `SPARE-FORECAST-${input.forecastMonth.replace("-", "")}-${requestKey}`;
    const result = await prisma.$transaction(async (tx) => {
      const created = [];
      const skipped = [];
      for (const item of input.items) {
        const demand = await upsertPurchaseDemandForSource(tx, {
          sourceType: "MONTHLY_PRODUCTION_PLAN",
          sourceRecordId,
          sourceLabel: input.sourceLabel,
          materialId: item.materialId,
          newDemand: item.quantity,
          needByDate: item.needByDate,
          createdById: user.id,
          stockPurpose: input.remark || "月度备件预测",
          replenishmentReason: "售后备件",
          forceCreate: true,
        });
        if (demand) created.push(demand);
        else skipped.push({ materialId: item.materialId, reason: "预计可用量已满足需求" });
      }
      await writeOperationLog(tx, {
        userId: user.id,
        action: "CREATE_MONTHLY_SPARE_PARTS_FORECAST",
        entityType: "PurchaseDemandBatch",
        entityId: sourceRecordId,
        afterData: { forecastMonth: input.forecastMonth, createdIds: created.map((item) => item.id), skipped },
      });
      return { sourceRecordId, sourceLabel: input.sourceLabel, created, skipped };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建月度备件预测失败" }, { status: 400 });
  }
}
