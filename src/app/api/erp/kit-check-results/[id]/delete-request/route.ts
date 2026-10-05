import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { canAccessERP, getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(); if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canAccessERP(user) || user.role === "WAREHOUSE") return NextResponse.json({ error: "无权限申请齐套删除" }, { status: 403 });
  const { id } = await params; const reason = String((await request.json()).reason || "").trim(); if (!reason) return NextResponse.json({ error: "删除原因必填" }, { status: 400 });
  const current = await prisma.kitCheckResult.findFirst({ where: { id, deletedAt: null } }); if (!current) return NextResponse.json({ error: "齐套结果不存在" }, { status: 404 });
  if (isSuperAdmin(user)) { const row = await prisma.$transaction(async (tx) => { const deleted = await tx.kitCheckResult.update({ where: { id }, data: { deletedAt: new Date(), deletedById: user.id, deleteReason: reason } }); await writeOperationLog(tx, { userId: user.id, action: "DELETE_KIT_CHECK_RESULT", entityType: "KitCheckResult", entityId: id, beforeData: current, afterData: { deletedAt: deleted.deletedAt, reason } }); return deleted; }); return NextResponse.json({ direct: true, item: row }); }
  const existing = await prisma.kitCheckDeleteRequest.findFirst({ where: { kitCheckResultId: id, status: "PENDING" } }); if (existing) return NextResponse.json({ error: "已有待审批删除申请" }, { status: 409 });
  const row = await prisma.$transaction(async (tx) => { const created = await tx.kitCheckDeleteRequest.create({ data: { kitCheckResultId: id, requesterId: user.id, reason } }); await writeOperationLog(tx, { userId: user.id, action: "REQUEST_DELETE_KIT_CHECK_RESULT", entityType: "KitCheckResult", entityId: id, afterData: { requestId: created.id, reason } }); return created; }); return NextResponse.json(row, { status: 201 });
}
