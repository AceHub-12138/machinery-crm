import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessERP } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canAccessERP(user)) {
    return NextResponse.json({ error: "无权限访问 ERP" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const warehouseId = searchParams.get("warehouseId") || "";
  const materialId = searchParams.get("materialId") || "";
  const type = searchParams.get("type") || "";
  const refType = searchParams.get("refType") || "";
  const refId = searchParams.get("refId") || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));

  const where: any = {};
  if (warehouseId) where.warehouseId = warehouseId;
  if (materialId) where.materialId = materialId;
  if (type) where.type = type;
  if (refType) where.refType = refType;
  if (refId) where.refId = refId;

  const skip = (page - 1) * pageSize;

  const [movements, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      include: {
        warehouse: { select: { id: true, name: true, code: true } },
        material: { select: { id: true, name: true, code: true, spec: true, unit: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.stockMovement.count({ where }),
  ]);

  return NextResponse.json({
    items: movements,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}
