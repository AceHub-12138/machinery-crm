import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin, canAccessCustomer } from "@/lib/permissions";
import { buildItemsFromInputs, sumItems, writeOperationLog } from "@/lib/sales-items";

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求数据格式错误，请刷新页面后重试" }, { status: 400 });
    }

    const rawItems = Array.isArray(body.items) && body.items.length
      ? body.items
      : body.productId
        ? [{ productId: body.productId, itemType: "MAIN", quotedPrice: body.quotedPrice, quantity: 1, sortOrder: 0 }]
        : [];

    if (!body.customerId || rawItems.length === 0) {
      return NextResponse.json({ error: "客户和报价产品为必填项" }, { status: 400 });
    }
    const mainInputs = rawItems.filter((item: any) => item.itemType === "MAIN" && item.productId);
    if (mainInputs.length === 0) {
      return NextResponse.json({ error: "报价至少需要一个主产品" }, { status: 400 });
    }
    if (mainInputs.some((item: any) => item.quotedPrice === undefined || item.quotedPrice === null || item.quotedPrice === "")) {
      return NextResponse.json({ error: "每条主产品都必须填写报价金额" }, { status: 400 });
    }

    const customer = await prisma.customer.findFirst({
      where: { id: body.customerId, deletedAt: null },
    });
    if (!customer) return NextResponse.json({ error: "客户不存在" }, { status: 404 });
    if (!canAccessCustomer(user, customer)) {
      return NextResponse.json({ error: "无权为该客户创建报价" }, { status: 403 });
    }

    const quote = await prisma.$transaction(async (tx) => {
      const itemData = await buildItemsFromInputs(tx, rawItems, "quotedPrice");
      const mainItem = itemData.find((item) => item.itemType === "MAIN");
      if (!mainItem) throw new Error("必须选择主产品");

      const totalAmount = sumItems(itemData);
      const created = await tx.customerQuote.create({
        data: {
          customerId: body.customerId,
          productId: mainItem.productId,
          quotedPrice: totalAmount,
          factoryPriceSnapshot: mainItem.factoryPriceSnapshot,
          currency: body.currency || "CNY",
          remark: body.remark || null,
          createdById: user.id,
          items: {
            create: itemData.map((item) => ({
              productId: item.productId,
              itemType: item.itemType,
              productNameSnapshot: item.productNameSnapshot,
              productModelSnapshot: item.productModelSnapshot,
              factoryPriceSnapshot: item.factoryPriceSnapshot,
              quotedPrice: item.quotedPrice,
              quantity: item.quantity,
              sortOrder: item.sortOrder,
            })),
          },
        },
        include: {
          product: { select: { model: true, category: true, factoryPrice: true } },
          items: { orderBy: { sortOrder: "asc" } },
          createdBy: { select: { name: true } },
        },
      });

      await tx.customer.update({
        where: { id: body.customerId },
        data: { status: "QUOTED" },
      });

      await writeOperationLog(tx, {
        userId: user.id,
        action: "CREATE_CUSTOMER_QUOTE",
        entityType: "CustomerQuote",
        entityId: created.id,
        afterData: created,
      });

      return created;
    });

    return NextResponse.json(quote, { status: 201 });
  } catch (error: any) {
    console.error("[customer-quotes.POST]", error);
    return NextResponse.json({ error: error.message || "创建报价失败" }, { status: 400 });
  }
}
