import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { canAccessCustomer, getSessionUser, isSuperAdmin } from "@/lib/permissions";
import { isContractLocked, writeOperationLog } from "@/lib/sales-items";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isSuperAdmin(user)) return NextResponse.json({ error: "无权查看审批记录" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "";
  const where: any = {};
  if (status) where.status = status;

  const requests = await prisma.contractUnlockRequest.findMany({
    where,
    include: {
      contract: {
        select: {
          id: true,
          contractNo: true,
          contractStatus: true,
          amount: true,
          customer: { select: { companyName: true, region: true, businessLine: true, province: true, city: true } },
        },
      },
      requester: { select: { id: true, name: true } },
      approver: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(requests);
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await request.json();
  if (!body.contractId || !body.reason) {
    return NextResponse.json({ error: "合同和申请原因为必填项" }, { status: 400 });
  }

  const contract = await prisma.contract.findFirst({
    where: { id: body.contractId, deletedAt: null },
    include: {
      customer: { select: { region: true, businessLine: true, province: true, city: true } },
      shipments: { select: { shipmentStatus: true } },
    },
  });
  if (!contract) return NextResponse.json({ error: "合同不存在" }, { status: 404 });
  if (!canAccessCustomer(user, contract.customer)) {
    return NextResponse.json({ error: "无权为该合同提交申请" }, { status: 403 });
  }
  if (!isContractLocked(contract)) {
    return NextResponse.json({ error: "当前合同未锁定，无需提交审批" }, { status: 400 });
  }

  const existing = await prisma.contractUnlockRequest.findFirst({
    where: { contractId: body.contractId, requesterId: user.id, status: "PENDING" },
  });
  if (existing) return NextResponse.json(existing, { status: 200 });

  const created = await prisma.$transaction(async (tx) => {
    const requestRecord = await tx.contractUnlockRequest.create({
      data: {
        contractId: body.contractId,
        requesterId: user.id,
        reason: body.reason,
      },
    });
    await writeOperationLog(tx, {
      userId: user.id,
      action: "REQUEST_CONTRACT_UNLOCK",
      entityType: "ContractUnlockRequest",
      entityId: requestRecord.id,
      afterData: requestRecord,
    });
    return requestRecord;
  });

  return NextResponse.json(created, { status: 201 });
}
