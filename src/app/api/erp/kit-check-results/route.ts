import { NextRequest, NextResponse } from "next/server";
import { KitCheckStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canAccessERP, getSessionUser } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canAccessERP(user)) return NextResponse.json({ error: "无权限访问 ERP" }, { status: 403 });
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "";
  const orderNo = searchParams.get("orderNo")?.trim() || "";
  const product = searchParams.get("product")?.trim() || "";
  const warehouseId = searchParams.get("warehouseId") || "";
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";
  const toExclusive = to ? new Date(`${to}T00:00:00`) : null;
  if (toExclusive) toExclusive.setDate(toExclusive.getDate() + 1);
  if (status && !Object.values(KitCheckStatus).includes(status as KitCheckStatus)) return NextResponse.json({ error: "齐套状态参数无效" }, { status: 400 });
  const where: Prisma.KitCheckResultWhereInput = {
    deletedAt: null,
    ...(status ? { status: status as KitCheckStatus } : {}),
    ...(warehouseId ? { warehouseId } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}), ...(toExclusive ? { lt: toExclusive } : {}) } } : {}),
    productionOrder: { deletedAt: null, ...(orderNo ? { orderNo: { contains: orderNo } } : {}), ...(product ? { OR: [{ productModelSnapshot: { contains: product } }, { productNameSnapshot: { contains: product } }] } : {}) },
  };
  const results = await prisma.kitCheckResult.findMany({ where, include: { productionOrder: { select: { id: true, orderNo: true, productModelSnapshot: true, productNameSnapshot: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  const warehouses = await prisma.warehouse.findMany({ where: { id: { in: [...new Set(results.map((item) => item.warehouseId))] } }, select: { id: true, name: true } });
  const warehouseById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
  return NextResponse.json({ items: results.map((item) => ({ ...item, warehouse: warehouseById.get(item.warehouseId) || null })) });
}
