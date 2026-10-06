import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin, canAccessCustomer, canSeeAllData, customerIsolationWhere } from "@/lib/permissions";
import { buildItemsFromInputs, sumItems, writeOperationLog } from "@/lib/sales-items";
import { contractStatusWhere, localStartOfDay, overdueShipmentWhere, parseLocalDate } from "@/modules/crm/dashboard/kpi-linkage";

function endExclusive(value: string) {
  const date = parseLocalDate(value)!;
  date.setDate(date.getDate() + 1);
  return date;
}

function startInclusive(value: string) {
  return parseLocalDate(value)!;
}

function applyDateRange(where: any, field: string, start?: string, end?: string) {
  if (!start && !end) return;
  where[field] = {};
  if (start) where[field].gte = startInclusive(start);
  if (end) where[field].lt = endExclusive(end);
}

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const tab = searchParams.get("tab") || "all";
    const paymentStatus = searchParams.get("paymentStatus") || "";
    const salesUserId = searchParams.get("salesUserId") || "";
    const kpiSalesUserId = searchParams.get("kpiSalesUserId") || "";
    const region = searchParams.get("region") || "";
    const contractStatus = searchParams.get("contractStatus") || "";
    const createdStart = searchParams.get("createdStart") || "";
    const createdEnd = searchParams.get("createdEnd") || "";
    const signedStart = searchParams.get("signedStart") || "";
    const signedEnd = searchParams.get("signedEnd") || "";
    const overdueShipment = searchParams.get("overdueShipment") || "";
    if ([createdStart, createdEnd, signedStart, signedEnd].some((value) => value && !parseLocalDate(value))) {
      return NextResponse.json({ error: "合同日期筛选格式错误" }, { status: 400 });
    }

    const where: any = { deletedAt: null };
    where.customer = {};

    if (!canSeeAllData(user)) {
      Object.assign(where.customer, customerIsolationWhere(user));
    } else if (region) {
      where.customer.region = region;
    }
    const province = searchParams.get("province") || "";
    const businessLine = searchParams.get("businessLine") || "";
    if (province) where.customer.province = province;
    if (businessLine && canSeeAllData(user)) where.customer.businessLine = businessLine;
    if (kpiSalesUserId) {
      if (canSeeAllData(user) || kpiSalesUserId === user.id) where.customer.assignedUserId = kpiSalesUserId;
      else where.customer.id = "__NO_ACCESS__";
    }
    if (Object.keys(where.customer).length === 0) {
      delete where.customer;
    }

    if (tab === "unpaid") where.paymentStatus = "UNPAID";
    else if (tab === "partial") where.paymentStatus = "PARTIAL_PAID";
    else if (tab === "paid") where.paymentStatus = "PAID";
    else if (tab === "won") where.contractStatus = "SIGNED";

    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (kpiSalesUserId && (canSeeAllData(user) || kpiSalesUserId === user.id)) {
      where.salesUserId = kpiSalesUserId;
    } else if (!kpiSalesUserId && salesUserId) {
      where.salesUserId = salesUserId;
      where.salesUser = { isActive: true };
    }

    Object.assign(where, contractStatusWhere(contractStatus));
    applyDateRange(where, "createdAt", createdStart, createdEnd);
    applyDateRange(where, "signedDate", signedStart, signedEnd);
    if (createdStart || createdEnd || overdueShipment === "1") {
      where.customer = { ...(where.customer || {}), deletedAt: null };
    }
    if (overdueShipment === "1") {
      Object.assign(where, overdueShipmentWhere(localStartOfDay(new Date())));
    }

    if (search) {
      where.OR = [
        { contractNo: { contains: search } },
        { customer: { companyName: { contains: search } } },
        { customer: { contactName: { contains: search } } },
        { equipmentModel: { contains: search } },
        { equipmentName: { contains: search } },
        { items: { some: { productNameSnapshot: { contains: search } } } },
        { items: { some: { productModelSnapshot: { contains: search } } } },
      ];
    }

    const contracts = await prisma.contract.findMany({
      where,
      include: {
        customer: { select: { id: true, companyName: true, contactName: true, region: true, businessLine: true, province: true, city: true, deletedAt: true } },
        salesUser: { select: { id: true, name: true, isActive: true } },
        payments: { orderBy: { paymentDate: "desc" }, take: 1 },
        shipments: { select: { id: true, shipmentStatus: true, shipmentDate: true } },
        items: { orderBy: { sortOrder: "asc" } },
        sourceQuote: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(contracts);
  } catch (error) {
    console.error("[contracts.GET]", error);
    return NextResponse.json({ error: "合同列表加载失败" }, { status: 500 });
  }
}

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
    if (!body.contractNo || !body.customerId) {
      return NextResponse.json({ error: "合同编号和客户为必填项" }, { status: 400 });
    }

    const customer = await prisma.customer.findFirst({
      where: { id: body.customerId, deletedAt: null },
    });
    if (!customer) return NextResponse.json({ error: "客户不存在" }, { status: 404 });
    if (!canAccessCustomer(user, customer)) {
      return NextResponse.json({ error: "无权为该客户创建合同" }, { status: 403 });
    }

    let sourceQuoteItems: any[] | null = null;
    if (body.sourceQuoteId) {
      const sourceQuote = await prisma.customerQuote.findFirst({
        where: { id: body.sourceQuoteId },
        select: {
          id: true,
          customerId: true,
          items: { orderBy: { sortOrder: "asc" } },
        },
      });
      if (!sourceQuote) return NextResponse.json({ error: "来源报价不存在" }, { status: 404 });
      if (sourceQuote.customerId !== body.customerId) {
        return NextResponse.json({ error: "来源报价与合同客户不一致" }, { status: 400 });
      }
      sourceQuoteItems = sourceQuote.items.map((item) => ({
        productId: item.productId,
        itemType: item.itemType,
        contractPrice: item.quotedPrice,
        quantity: item.quantity,
        sortOrder: item.sortOrder,
      }));
      const existing = await prisma.contract.findFirst({
        where: { sourceQuoteId: body.sourceQuoteId, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        return NextResponse.json({ error: "该报价已生成合同，不能重复创建", contractId: existing.id }, { status: 409 });
      }
    }

    const rawItems = sourceQuoteItems?.length
      ? sourceQuoteItems
      : Array.isArray(body.items) && body.items.length
        ? body.items
        : body.productId
          ? [{ productId: body.productId, itemType: "MAIN", contractPrice: body.amount, quantity: 1, sortOrder: 0 }]
          : [];

    if (rawItems.length === 0) {
      return NextResponse.json({ error: "合同至少需要一个主产品明细" }, { status: 400 });
    }

    const contract = await prisma.$transaction(async (tx) => {
      const itemData = await buildItemsFromInputs(tx, rawItems, "contractPrice");
      const mainItem = itemData.find((item) => item.itemType === "MAIN");
      if (!mainItem) throw new Error("必须选择主产品");

      const itemTotal = sumItems(itemData);
      const amount = itemTotal;

      const created = await tx.contract.create({
        data: {
          contractNo: body.contractNo,
          signedDate: new Date(body.signedDate || new Date()),
          estimatedShipmentDate: body.estimatedShipmentDate ? new Date(body.estimatedShipmentDate) : null,
          customerId: body.customerId,
          salesUserId: body.salesUserId || user.id,
          productId: mainItem.productId,
          sourceQuoteId: body.sourceQuoteId || null,
          equipmentName: mainItem.productNameSnapshot,
          equipmentModel: mainItem.productModelSnapshot,
          amount,
          paidAmount: 0,
          unpaidAmount: amount,
          currency: body.currency || "CNY",
          attachmentUrl: body.attachmentUrl || null,
          remark: body.remark || null,
          paymentStatus: "UNPAID",
          contractStatus: body.contractStatus || "SIGNED",
          createdById: user.id,
          items: {
            create: itemData.map((item) => ({
              productId: item.productId,
              itemType: item.itemType,
              productNameSnapshot: item.productNameSnapshot,
              productModelSnapshot: item.productModelSnapshot,
              factoryPriceSnapshot: item.factoryPriceSnapshot,
              contractPrice: item.contractPrice,
              quantity: item.quantity,
              estimatedShipmentDate: item.estimatedShipmentDate,
              sortOrder: item.sortOrder,
            })),
          },
        },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      });

      if (created.contractStatus === "SIGNED") {
        await tx.customer.update({
          where: { id: body.customerId },
          data: { status: "WON" },
        });
      }

      await writeOperationLog(tx, {
        userId: user.id,
        action: body.sourceQuoteId ? "QUOTE_TO_CONTRACT" : "CREATE_CONTRACT",
        entityType: "Contract",
        entityId: created.id,
        afterData: created,
      });

      return created;
    });

    return NextResponse.json(contract, { status: 201 });
  } catch (error: any) {
    console.error("[contracts.POST]", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "合同编号重复，请更换合同编号" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message || "创建合同失败" }, { status: 400 });
  }
}
