import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin, canAccessCustomer } from "@/lib/permissions";
import { canEditContract, lockedContractMessage, recalculateContractPayments, writeOperationLog } from "@/lib/sales-items";

async function getContractForPayment(contractId: string) {
  return prisma.contract.findFirst({
    where: { id: contractId, deletedAt: null },
    include: {
      customer: { select: { region: true, businessLine: true, province: true, city: true } },
      shipments: { select: { shipmentStatus: true } },
    },
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id, paymentId } = await params;
  const body = await request.json();
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: "回款金额不能小于 0" }, { status: 400 });
  }

  const contract = await getContractForPayment(id);
  if (!contract) return NextResponse.json({ error: "合同不存在" }, { status: 404 });
  if (!canAccessCustomer(user, contract.customer)) {
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  }
  if (!canEditContract(user, contract)) {
    return NextResponse.json({ error: lockedContractMessage() }, { status: 423 });
  }

  const before = await prisma.contractPayment.findFirst({
    where: { id: paymentId, contractId: id },
  });
  if (!before) return NextResponse.json({ error: "回款记录不存在" }, { status: 404 });
  if (before.status === "VOIDED") {
    return NextResponse.json({ error: "已作废回款不能修改" }, { status: 400 });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const after = await tx.contractPayment.update({
        where: { id: paymentId },
        data: {
          amount,
          paymentDate: body.paymentDate ? new Date(body.paymentDate) : before.paymentDate,
          paymentMethod: body.paymentMethod || null,
          remark: body.remark || null,
        },
      });
      await recalculateContractPayments(tx, id);
      await writeOperationLog(tx, {
        userId: user.id,
        action: "UPDATE_PAYMENT",
        entityType: "ContractPayment",
        entityId: paymentId,
        beforeData: before,
        afterData: after,
      });
      return after;
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "修改回款失败" }, { status: 400 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id, paymentId } = await params;
  const contract = await getContractForPayment(id);
  if (!contract) return NextResponse.json({ error: "合同不存在" }, { status: 404 });
  if (!canAccessCustomer(user, contract.customer)) {
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  }
  if (!canEditContract(user, contract)) {
    return NextResponse.json({ error: lockedContractMessage() }, { status: 423 });
  }

  const before = await prisma.contractPayment.findFirst({
    where: { id: paymentId, contractId: id },
  });
  if (!before) return NextResponse.json({ error: "回款记录不存在" }, { status: 404 });
  if (before.status === "VOIDED") return NextResponse.json({ success: true });

  try {
    await prisma.$transaction(async (tx) => {
      const after = await tx.contractPayment.update({
        where: { id: paymentId },
        data: { status: "VOIDED" },
      });
      await recalculateContractPayments(tx, id);
      await writeOperationLog(tx, {
        userId: user.id,
        action: "DELETE_PAYMENT",
        entityType: "ContractPayment",
        entityId: paymentId,
        beforeData: before,
        afterData: after,
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "删除回款失败" }, { status: 400 });
  }
}
