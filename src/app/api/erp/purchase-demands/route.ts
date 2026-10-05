import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma, ProcurementSourceType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, canManagePurchaseDemands } from "@/lib/permissions";
import { upsertPurchaseDemandForSource } from "@/lib/procurement-planning";
import { writeOperationLog } from "@/lib/sales-items";

const SOURCE_TYPES = new Set(Object.values(ProcurementSourceType));
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canManagePurchaseDemands(user)) return NextResponse.json({ error: "无权限查看采购需求" }, { status: 403 });
  const sourceType = new URL(request.url).searchParams.get("sourceType") || "";
  const scope = new URL(request.url).searchParams.get("scope") || "";
  return NextResponse.json(await prisma.purchaseDemand.findMany({ where: { ...(SOURCE_TYPES.has(sourceType as ProcurementSourceType) ? { sourceType: sourceType as ProcurementSourceType } : {}), ...(scope === "spareForecast" ? { sourceRecordId: { startsWith: "SPARE-FORECAST-" } } : {}), activeSlot: true }, include: { material: true, allocations: true }, orderBy: { createdAt: "desc" } }));
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canManagePurchaseDemands(user)) return NextResponse.json({ error: "无权限创建采购需求" }, { status: 403 });
  const body = await request.json();
  const sourceType = String(body.sourceType || "") as ProcurementSourceType;
  if (!["STOCK_REPLENISHMENT", "MANUAL"].includes(sourceType)) return NextResponse.json({ error: "手工创建仅支持备货或手工采购来源" }, { status: 400 });
  let quantity: Prisma.Decimal;
  try { quantity = new Prisma.Decimal(String(body.quantity)); } catch { return NextResponse.json({ error: "需求数量无效" }, { status: 400 }); }
  const needByDate = new Date(String(body.needByDate || ""));
  if (!body.materialId || !quantity.gt(0) || Number.isNaN(needByDate.getTime())) return NextResponse.json({ error: "备货物料、数量和计划需要日期为必填项" }, { status: 400 });
  const sourceRecordId = String(body.sourceRecordId || `MANUAL-${randomUUID()}`);
  try {
    const demand = await prisma.$transaction(async (tx) => {
      const created = await upsertPurchaseDemandForSource(tx, {
        sourceType, sourceRecordId, sourceLabel: sourceType === "STOCK_REPLENISHMENT" ? "备货" : "手工采购需求",
        materialId: String(body.materialId), newDemand: quantity, needByDate, createdById: user.id,
        stockPurpose: String(body.stockPurpose || "") || null, replenishmentReason: String(body.replenishmentReason || "") || null,
        targetStockQuantity: body.targetStockQuantity || null, forceCreate: true,
      });
      if (created) await writeOperationLog(tx, { userId: user.id, action: "CREATE_PURCHASE_DEMAND", entityType: "PurchaseDemand", entityId: created.id, afterData: created });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return demand ? NextResponse.json(demand, { status: 201 }) : NextResponse.json({ error: "预计可用量已满足需求，无需生成采购草稿" }, { status: 409 });
  } catch (error: any) { return NextResponse.json({ error: error?.code === "P2002" ? "同一来源和物料已存在有效采购需求" : error?.message || "创建失败" }, { status: error?.code === "P2002" ? 409 : 400 }); }
}
