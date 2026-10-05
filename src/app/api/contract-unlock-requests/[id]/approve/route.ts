import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isSuperAdmin(user)) return NextResponse.json({ error: "无权审批" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const before = await prisma.contractUnlockRequest.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "审批记录不存在" }, { status: 404 });
  if (before.status !== "PENDING") {
    return NextResponse.json({ error: "该申请已处理" }, { status: 400 });
  }

  const approved = await prisma.$transaction(async (tx) => {
    const after = await tx.contractUnlockRequest.update({
      where: { id },
      data: {
        status: "APPROVED",
        approverId: user.id,
        approvalRemark: body.approvalRemark || null,
        approvedAt: new Date(),
      },
    });
    await tx.contract.update({
      where: { id: before.contractId },
      data: {
        editUnlockedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
        editUnlockRequestId: id,
      },
    });
    await writeOperationLog(tx, {
      userId: user.id,
      action: "APPROVE_CONTRACT_UNLOCK",
      entityType: "ContractUnlockRequest",
      entityId: id,
      beforeData: before,
      afterData: after,
    });
    return after;
  });

  return NextResponse.json(approved);
}
