import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canExecuteKitCheck, getSessionUser } from "@/lib/permissions";
import { createKitCheckResult, ProductionOrderRequestError } from "@/lib/production-orders";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canExecuteKitCheck(user)) return NextResponse.json({ error: "无权限执行齐套检查" }, { status: 403 });
  const { id } = await params;
  try {
    const result = await prisma.$transaction((tx) => createKitCheckResult(tx, { productionOrderId: id, checkedById: user.id }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ProductionOrderRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
