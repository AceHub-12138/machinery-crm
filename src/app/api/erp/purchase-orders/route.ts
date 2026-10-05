import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, canAccessERP, canManagePurchaseOrders } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { autoDocumentPrefix, DOCUMENT_NUMBER_RULES_KEY, formatAutoDocumentNo, normalizeAutoDocumentRules } from "@/lib/document-number";

type PurchaseOrderItemInput = {
  materialId?: string;
  quantity?: string | number;
  unitPrice?: string | number;
};

type NormalizedItem = {
  materialId: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  amount: Prisma.Decimal;
  sortOrder: number;
};

const PURCHASE_ORDER_STATUSES = ["DRAFT", "ORDERED", "PARTIAL_RECEIVED", "RECEIVED", "CANCELLED"] as const;

function parsePositiveDecimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? new Prisma.Decimal(parsed).toDecimalPlaces(2) : null;
}

function parseNonNegativeDecimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? new Prisma.Decimal(parsed).toDecimalPlaces(2) : null;
}

function normalizeItems(rawItems: unknown): NormalizedItem[] | null {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return null;
  const items = rawItems.map((raw: PurchaseOrderItemInput, index) => {
    const quantity = parsePositiveDecimal(raw.quantity);
    const unitPrice = parseNonNegativeDecimal(raw.unitPrice);
    return {
      materialId: String(raw.materialId || ""),
      quantity,
      unitPrice,
      amount: quantity && unitPrice ? quantity.mul(unitPrice).toDecimalPlaces(2) : null,
      sortOrder: index,
    };
  });
  if (items.some((item) => !item.materialId || !item.quantity || !item.unitPrice || !item.amount)) return null;
  if (new Set(items.map((item) => item.materialId)).size !== items.length) return null;
  return items as NormalizedItem[];
}

function parseDate(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function generateOrderNo(tx: Prisma.TransactionClient) {
  const rules = normalizeAutoDocumentRules((await tx.systemSetting.findUnique({ where: { key: DOCUMENT_NUMBER_RULES_KEY } }))?.value);
  const rule = rules.PURCHASE_ORDER;
  const count = await tx.purchaseOrder.count({ where: { orderNo: { startsWith: autoDocumentPrefix(rule) } } });
  return formatAutoDocumentNo(rule, count);
}

async function buildItemData(tx: Prisma.TransactionClient, items: NormalizedItem[]) {
  const materialIds = items.map((item) => item.materialId);
  const materials = await tx.material.findMany({
    where: { id: { in: materialIds }, isActive: true, deletedAt: null },
    select: { id: true, code: true, name: true, spec: true },
  });
  const materialById = new Map(materials.map((material) => [material.id, material]));
  if (materialById.size !== materialIds.length) throw new Error("采购明细中存在不存在或已停用的物料");
  return items.map((item) => {
    const material = materialById.get(item.materialId)!;
    return {
      purchaseOrderId: "",
      materialId: item.materialId,
      materialCodeSnapshot: material.code,
      materialNameSnapshot: material.name,
      materialSpecSnapshot: material.spec,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.amount,
      sortOrder: item.sortOrder,
    };
  });
}

async function verifySupplier(tx: Prisma.TransactionClient, supplierId: string) {
  const supplier = await tx.supplier.findFirst({
    where: { id: supplierId, isActive: true, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!supplier) throw new Error("供应商不存在或已停用");
  return supplier;
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canAccessERP(user)) return NextResponse.json({ error: "无权限访问 ERP" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() || "";
  const supplierId = searchParams.get("supplierId") || "";
  const status = searchParams.get("status") || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));
  if (status && !PURCHASE_ORDER_STATUSES.includes(status as (typeof PURCHASE_ORDER_STATUSES)[number])) {
    return NextResponse.json({ error: "采购订单状态参数无效" }, { status: 400 });
  }
  const where: any = { deletedAt: null };
  if (user.role === "WAREHOUSE") where.status = { in: ["ORDERED", "PARTIAL_RECEIVED", "RECEIVED"] };
  if (supplierId) where.supplierId = supplierId;
  if (status) {
    if (user.role === "WAREHOUSE" && !["ORDERED", "PARTIAL_RECEIVED", "RECEIVED"].includes(status)) {
      return NextResponse.json({ error: "仓库管理只能查看已提交或已批准的采购订单" }, { status: 403 });
    }
    where.status = status;
  }
  if (search) {
    where.OR = [
      { orderNo: { contains: search } },
      { supplierNameSnapshot: { contains: search } },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.purchaseOrder.count({ where }),
  ]);
  const summaries = orders.length
    ? await prisma.purchaseOrderItem.groupBy({
        by: ["purchaseOrderId"],
        where: { purchaseOrderId: { in: orders.map((order) => order.id) } },
        _count: { _all: true },
        _sum: { amount: true },
      })
    : [];
  const summaryByOrderId = new Map(summaries.map((summary) => [summary.purchaseOrderId, summary]));
  const items = orders.map((order) => {
    const summary = summaryByOrderId.get(order.id);
    return {
      ...order,
      itemCount: summary?._count._all || 0,
      totalAmount: summary?._sum.amount || new Prisma.Decimal(0),
    };
  });

  return NextResponse.json({
    items,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canManagePurchaseOrders(user)) return NextResponse.json({ error: "无权限创建采购订单" }, { status: 403 });

  const body = await request.json();
  const supplierId = String(body.supplierId || "");
  const orderDate = parseDate(body.orderDate);
  const expectedArrivalDate = body.expectedArrivalDate ? parseDate(body.expectedArrivalDate) : null;
  const items = normalizeItems(body.items);
  if (!supplierId || !orderDate || !items || (body.expectedArrivalDate && !expectedArrivalDate)) {
    return NextResponse.json({ error: "请填写供应商、订单日期和有效的采购明细；数量需大于 0，单价不能小于 0，且物料不能重复" }, { status: 400 });
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const order = await prisma.$transaction(async (tx) => {
        const supplier = await verifySupplier(tx, supplierId);
        const itemData = await buildItemData(tx, items);
        const created = await tx.purchaseOrder.create({
          data: {
            orderNo: await generateOrderNo(tx),
            supplierId: supplier.id,
            supplierNameSnapshot: supplier.name,
            orderDate,
            expectedArrivalDate,
            remark: String(body.remark || "").trim() || null,
            createdById: user.id,
          },
        });
        await tx.purchaseOrderItem.createMany({
          data: itemData.map((item) => ({ ...item, purchaseOrderId: created.id })),
        });
        const afterItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: created.id }, orderBy: { sortOrder: "asc" } });
        await writeOperationLog(tx, {
          userId: user.id,
          action: "CREATE_PURCHASE_ORDER",
          entityType: "PurchaseOrder",
          entityId: created.id,
          afterData: { ...created, items: afterItems },
        });
        return created;
      });
      return NextResponse.json(order, { status: 201 });
    } catch (error: any) {
      if (error?.code === "P2002" && attempt < 2) continue;
      if (error instanceof Error && ["供应商不存在或已停用", "采购明细中存在不存在或已停用的物料"].includes(error.message)) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  }
  return NextResponse.json({ error: "采购订单创建失败，请重试" }, { status: 409 });
}
