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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const contract = await getContractForPayment(id);
  if (!contract) return NextResponse.json({ error: "合同不存在" }, { status: 404 });
  if (!canAccessCustomer(user, contract.customer)) {
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  }

  const payments = await prisma.contractPayment.findMany({
    where: { contractId: id },
    include: { createdBy: { select: { id: true, name: true } } },
    orderBy: { paymentDate: "desc" },
  });
  return NextResponse.json(payments);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: "回款金额不能小于 0" }, { status: 400 });
  }
  if (!body.paymentDate) {
    return NextResponse.json({ error: "回款日期为必填项" }, { status: 400 });
  }

  const contract = await getContractForPayment(id);
  if (!contract) return NextResponse.json({ error: "合同不存在" }, { status: 404 });
  if (!canAccessCustomer(user, contract.customer)) {
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  }
  if (!canEditContract(user, contract)) {
    return NextResponse.json({ error: lockedContractMessage() }, { status: 423 });
  }

  try {
    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.contractPayment.create({
        data: {
          contractId: id,
          amount,
          paymentDate: new Date(body.paymentDate),
          paymentMethod: body.paymentMethod || null,
          remark: body.remark || null,
          status: "ACTIVE",
          createdById: user.id,
        },
      });
      await recalculateContractPayments(tx, id);
      await writeOperationLog(tx, {
        userId: user.id,
        action: "CREATE_PAYMENT",
        entityType: "ContractPayment",
        entityId: created.id,
        afterData: created,
      });
      return created;
    });
    return NextResponse.json(payment, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "新增回款失败" }, { status: 400 });
  }
}
