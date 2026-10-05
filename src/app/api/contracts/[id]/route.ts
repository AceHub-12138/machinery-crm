import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin, canAccessCustomer } from "@/lib/permissions";
import {
  assertAmountCoversPaid,
  buildItemsFromInputs,
  canEditContract,
  isContractLocked,
  lockedContractMessage,
  paymentStatusFor,
  sumItems,
  writeOperationLog,
} from "@/lib/sales-items";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { id } = await params;
    const contract = await prisma.contract.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: { select: { id: true, companyName: true, contactName: true, phone: true, region: true, businessLine: true, province: true, city: true } },
      salesUser: { select: { id: true, name: true } },
      product: { select: { id: true, model: true, category: true, factoryPrice: true } },
      sourceQuote: { select: { id: true } },
      items: {
        orderBy: { sortOrder: "asc" },
        include: { product: { include: { translations: { where: { language: "ZH" } } } } },
      },
      payments: {
        include: { createdBy: { select: { id: true, name: true } } },
        orderBy: { paymentDate: "desc" },
      },
      shipments: {
        include: { createdBy: { select: { id: true, name: true } } },
        orderBy: { shipmentDate: "desc" },
      },
      unlockRequests: {
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          requester: { select: { id: true, name: true } },
          approver: { select: { id: true, name: true } },
        },
      },
      createdBy: { select: { id: true, name: true } },
    },
  });

    if (!contract) return NextResponse.json({ error: "合同不存在" }, { status: 404 });
    if (!canAccessCustomer(user, contract.customer)) {
      return NextResponse.json({ error: "无权查看该合同" }, { status: 403 });
    }

    return NextResponse.json({
      ...contract,
      isLocked: isContractLocked(contract),
      canEdit: canEditContract(user, contract),
    });
  } catch (error) {
    console.error("[contracts.id.GET]", error);
    return NextResponse.json({ error: "合同详情加载失败" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求数据格式错误，请刷新页面后重试" }, { status: 400 });
  }

  const contract = await prisma.contract.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: { select: { region: true, businessLine: true, province: true, city: true } },
      shipments: { select: { shipmentStatus: true } },
      items: true,
    },
  });
  if (!contract) return NextResponse.json({ error: "合同不存在" }, { status: 404 });
  if (!canAccessCustomer(user, contract.customer)) {
    return NextResponse.json({ error: "无权编辑该合同" }, { status: 403 });
  }
  if (!canEditContract(user, contract)) {
    return NextResponse.json({ error: lockedContractMessage() }, { status: 423 });
  }

  const customerId = body.customerId || contract.customerId;
  const customer = await prisma.customer.findFirst({ where: { id: customerId, deletedAt: null } });
  if (!customer) return NextResponse.json({ error: "客户不存在" }, { status: 404 });
  if (!canAccessCustomer(user, customer)) {
    return NextResponse.json({ error: "无权将合同转给该客户" }, { status: 403 });
  }

  const rawItems = Array.isArray(body.items) && body.items.length
    ? body.items
    : body.productId
      ? [{ productId: body.productId, itemType: "MAIN", contractPrice: body.amount ?? contract.amount, quantity: 1, sortOrder: 0 }]
      : contract.items.map((item) => ({
          productId: item.productId,
          itemType: item.itemType,
          contractPrice: item.contractPrice,
          quantity: item.quantity,
          estimatedShipmentDate: item.estimatedShipmentDate,
          sortOrder: item.sortOrder,
        }));

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const itemData = await buildItemsFromInputs(tx, rawItems, "contractPrice");
      const mainItem = itemData.find((item) => item.itemType === "MAIN");
      if (!mainItem) throw new Error("必须选择主产品");

      const itemTotal = sumItems(itemData);
      const amount = itemTotal;
      const paidAmount = Number(contract.paidAmount || 0);
      assertAmountCoversPaid(amount, paidAmount);

      const beforeData = await tx.contract.findUnique({
        where: { id },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      });

      await tx.contractItem.deleteMany({ where: { contractId: id } });
      await tx.contractItem.createMany({
        data: itemData.map((item) => ({ ...item, contractId: id })),
      });

      const after = await tx.contract.update({
        where: { id },
        data: {
          contractNo: body.contractNo ?? contract.contractNo,
          signedDate: body.signedDate ? new Date(body.signedDate) : undefined,
          estimatedShipmentDate: body.estimatedShipmentDate !== undefined
            ? (body.estimatedShipmentDate ? new Date(body.estimatedShipmentDate) : null)
            : undefined,
          customerId,
          salesUserId: body.salesUserId || undefined,
          productId: mainItem.productId,
          equipmentName: mainItem.productNameSnapshot,
          equipmentModel: mainItem.productModelSnapshot,
          amount,
          paidAmount,
          unpaidAmount: amount - paidAmount,
          paymentStatus: paymentStatusFor(amount, paidAmount),
          attachmentUrl: body.attachmentUrl !== undefined ? (body.attachmentUrl || null) : undefined,
          remark: body.remark !== undefined ? (body.remark || null) : undefined,
          contractStatus: body.contractStatus || undefined,
        },
        include: {
          items: { orderBy: { sortOrder: "asc" } },
          customer: { select: { id: true, companyName: true, contactName: true, region: true, businessLine: true, province: true, city: true } },
        },
      });

      if (!isSuperAdmin(user) && contract.editUnlockRequestId) {
        await tx.contractUnlockRequest.updateMany({
          where: { id: contract.editUnlockRequestId, status: "APPROVED" },
          data: { status: "USED", usedAt: new Date() },
        });
        await tx.contract.update({
          where: { id },
          data: { editUnlockedUntil: null, editUnlockRequestId: null },
        });
      }

      await writeOperationLog(tx, {
        userId: user.id,
        action: "UPDATE_CONTRACT",
        entityType: "Contract",
        entityId: id,
        beforeData,
        afterData: after,
      });

      return after;
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "保存合同失败" }, { status: 400 });
  }
  } catch (error: any) {
    console.error("[contracts.id.PUT]", error);
    return NextResponse.json({ error: error.message || "保存合同失败" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isSuperAdmin(user)) return NextResponse.json({ error: "无权删除合同" }, { status: 403 });

  const { id } = await params;
  const before = await prisma.contract.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "合同不存在" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    const after = await tx.contract.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeOperationLog(tx, {
      userId: user.id,
      action: "DELETE_CONTRACT",
      entityType: "Contract",
      entityId: id,
      beforeData: before,
      afterData: after,
    });
  });
  return NextResponse.json({ success: true });
}
