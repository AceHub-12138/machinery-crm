import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";

// 超级管理员同意删除申请 —— 同意后在同一事务内执行“软删除”（仅打删除标记，数据保留）
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isSuperAdmin(user)) return NextResponse.json({ error: "无权审批" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const before = await prisma.contractDeleteRequest.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "审批记录不存在" }, { status: 404 });
  if (before.status !== "PENDING") {
    return NextResponse.json({ error: "该申请已处理" }, { status: 400 });
  }

  const approved = await prisma.$transaction(async (tx) => {
    const after = await tx.contractDeleteRequest.update({
      where: { id },
      data: {
        status: "APPROVED",
        approverId: user.id,
        approvalRemark: body.approvalRemark || null,
        approvedAt: new Date(),
      },
    });

    // 仅当合同尚未被删除时才执行软删除
    const contractBefore = await tx.contract.findUnique({ where: { id: before.contractId } });
    if (contractBefore && !contractBefore.deletedAt) {
      const contractAfter = await tx.contract.update({
        where: { id: before.contractId },
        data: { deletedAt: new Date() },
      });
      await writeOperationLog(tx, {
        userId: user.id,
        action: "DELETE_CONTRACT_VIA_APPROVAL",
        entityType: "Contract",
        entityId: before.contractId,
        beforeData: contractBefore,
        afterData: contractAfter,
      });
    }

    await writeOperationLog(tx, {
      userId: user.id,
      action: "APPROVE_CONTRACT_DELETE",
      entityType: "ContractDeleteRequest",
      entityId: id,
      beforeData: before,
      afterData: after,
    });

    return after;
  });

  return NextResponse.json(approved);
}
