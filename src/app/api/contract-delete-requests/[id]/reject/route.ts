import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";

// 超级管理员拒绝删除申请 —— 拒绝不会改动合同，合同保持原样
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isSuperAdmin(user)) return NextResponse.json({ error: "无权审批" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (!body.approvalRemark) {
    return NextResponse.json({ error: "拒绝时必须填写审批备注" }, { status: 400 });
  }

  const before = await prisma.contractDeleteRequest.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "审批记录不存在" }, { status: 404 });
  if (before.status !== "PENDING") {
    return NextResponse.json({ error: "该申请已处理" }, { status: 400 });
  }

  const rejected = await prisma.$transaction(async (tx) => {
    const after = await tx.contractDeleteRequest.update({
      where: { id },
      data: {
        status: "REJECTED",
        approverId: user.id,
        approvalRemark: body.approvalRemark,
        rejectedAt: new Date(),
      },
    });
    await writeOperationLog(tx, {
      userId: user.id,
      action: "REJECT_CONTRACT_DELETE",
      entityType: "ContractDeleteRequest",
      entityId: id,
      beforeData: before,
      afterData: after,
    });
    return after;
  });

  return NextResponse.json(rejected);
}
