import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canManagePurchaseDemands, getSessionUser } from "@/lib/permissions";
import { createPurchaseDemandsForKitCheck, ProductionOrderRequestError } from "@/lib/production-orders";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canManagePurchaseDemands(user)) return NextResponse.json({ error: "无权限生成采购需求" }, { status: 403 });
  const { id } = await params;
  const body = await request.json();
  try {
    const result = await prisma.$transaction((tx) => createPurchaseDemandsForKitCheck(tx, { productionOrderId: id, kitCheckId: String(body.kitCheckId || ""), createdById: user.id }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ProductionOrderRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
