import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { canAccessCustomer, getSessionUser } from "@/lib/permissions";
import {
  assertAmountCoversPaid,
  canEditContract,
  lockedContractMessage,
  paymentStatusFor,
  sumItems,
  writeOperationLog,
} from "@/lib/sales-items";

function contractItemsFromQuoteItems(items: any[]) {
  return items.map((item: any) => ({
    productId: item.productId,
    itemType: item.itemType,
    productNameSnapshot: item.productNameSnapshot,
    productModelSnapshot: item.productModelSnapshot,
    factoryPriceSnapshot: item.factoryPriceSnapshot === null || item.factoryPriceSnapshot === undefined ? null : Number(item.factoryPriceSnapshot),
    contractPrice: item.quotedPrice === null || item.quotedPrice === undefined ? 0 : Number(item.quotedPrice),
    quantity: item.quantity || 1,
    sortOrder: item.sortOrder || 0,
  }));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const quote = await prisma.customerQuote.findFirst({
    where: { id },
    include: {
      customer: { select: { id: true, region: true, businessLine: true, province: true, city: true } },
      items: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!quote) return NextResponse.json({ error: "报价不存在" }, { status: 404 });
  if (!canAccessCustomer(user, quote.customer)) {
    return NextResponse.json({ error: "无权更新该报价关联合同" }, { status: 403 });
  }

  const contract = await prisma.contract.findFirst({
    where: { sourceQuoteId: id, deletedAt: null },
    include: {
      customer: { select: { region: true, businessLine: true, province: true, city: true } },
      shipments: { select: { shipmentStatus: true } },
      items: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!contract) return NextResponse.json({ error: "该报价尚未生成合同" }, { status: 404 });
  if (!canEditContract(user, contract)) {
    return NextResponse.json({ error: lockedContractMessage() }, { status: 423 });
  }

  const mainItem = quote.items.find((item) => item.itemType === "MAIN");
  if (!mainItem) return NextResponse.json({ error: "报价缺少主产品明细" }, { status: 400 });

  const contractItems = contractItemsFromQuoteItems(quote.items);
  const amount = sumItems(contractItems);
  const paidAmount = Number(contract.paidAmount || 0);

  try {
    assertAmountCoversPaid(amount, paidAmount);
  } catch {
    return NextResponse.json({ error: "新合同金额低于当前已收款金额，无法自动更新，请先处理回款记录或手动修改合同。" }, { status: 400 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const beforeData = await tx.contract.findUnique({
      where: { id: contract.id },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });

    await tx.contractItem.deleteMany({ where: { contractId: contract.id } });
    await tx.contractItem.createMany({
      data: contractItems.map((item) => ({ ...item, contractId: contract.id })),
    });

    const after = await tx.contract.update({
      where: { id: contract.id },
      data: {
        customerId: quote.customerId,
        productId: mainItem.productId,
        equipmentName: mainItem.productNameSnapshot,
        equipmentModel: mainItem.productModelSnapshot,
        amount,
        paidAmount,
        unpaidAmount: amount - paidAmount,
        paymentStatus: paymentStatusFor(amount, paidAmount),
      },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        customer: { select: { id: true, companyName: true, contactName: true, region: true, businessLine: true, province: true, city: true } },
      },
    });

    await writeOperationLog(tx, {
      userId: user.id,
      action: "QUOTE_UPDATE_CONTRACT",
      entityType: "Contract",
      entityId: contract.id,
      beforeData,
      afterData: after,
    });

    return after;
  });

  return NextResponse.json(updated);
  } catch (error: any) {
    console.error("[customer-quotes.update-contract.POST]", error);
    return NextResponse.json({ error: error.message || "报价更新合同失败" }, { status: 400 });
  }
}
