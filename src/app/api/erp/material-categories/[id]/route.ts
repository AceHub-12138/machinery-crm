import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, canManageMaterialMaster } from "@/lib/permissions";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canManageMaterialMaster(user)) {
    return NextResponse.json({ error: "无权限设置分类预警" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const raw = body.warningThreshold;
  const warningThreshold = raw === "" || raw === null || raw === undefined ? null : Number(raw);

  if (warningThreshold !== null && (!Number.isFinite(warningThreshold) || warningThreshold < 0)) {
    return NextResponse.json({ error: "预警数量必须为非负数字" }, { status: 400 });
  }

  const category = await prisma.materialCategory.update({
    where: { id },
    data: { warningThreshold },
  });

  return NextResponse.json(category);
}
