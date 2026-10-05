import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, canManagePurchaseOrders } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { autoDocumentPrefix, DOCUMENT_NUMBER_RULES_KEY, formatAutoDocumentNo, normalizeAutoDocumentRules } from "@/lib/document-number";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canManagePurchaseOrders(user)) return NextResponse.json({ error: "无权限" }, { status: 403 });
  const body = await request.json();
  if (!body.supplierId || !Array.isArray(body.allocations) || !body.allocations.length) return NextResponse.json({ error: "供应商和需求分摊为必填项" }, { status: 400 });
  try {
    const created = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({ where: { id: String(body.supplierId), isActive: true, deletedAt: null } });
      if (!supplier) throw new Error("供应商不存在或已停用");
      const rawDemandIds: string[] = body.allocations.map((row: any) => String(row.purchaseDemandId));
      const demandIds: string[] = Array.from(new Set<string>(rawDemandIds));
      if (demandIds.length !== rawDemandIds.length) throw new Error("同一采购需求不能重复分摊，请合并数量");
      for (const demandId of demandIds) await tx.$queryRaw`SELECT id FROM erp_purchase_demands WHERE id = ${demandId} FOR UPDATE`;
      const demands = await tx.purchaseDemand.findMany({ where: { id: { in: demandIds }, activeSlot: true, status: { in: ["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_CONVERTED"] } }, include: { material: true } });
      if (demands.length !== demandIds.length) throw new Error("部分采购需求已取消、已转换或不存在");
      const demandById = new Map(demands.map((row) => [row.id, row]));
      const grouped = new Map<string, Array<{ demand: typeof demands[number]; quantity: Prisma.Decimal }>>();
      for (const raw of body.allocations) {
        const demand = demandById.get(String(raw.purchaseDemandId));
        const quantity = new Prisma.Decimal(String(raw.quantity || 0));
        if (!demand || !quantity.gt(0) || quantity.gt(new Prisma.Decimal(demand.suggestedQuantity).sub(demand.convertedQuantity))) throw new Error("分摊数量超过采购需求剩余数量");
        grouped.set(demand.materialId, [...(grouped.get(demand.materialId) || []), { demand, quantity }]);
      }
      const numberRule=normalizeAutoDocumentRules((await tx.systemSetting.findUnique({where:{key:DOCUMENT_NUMBER_RULES_KEY}}))?.value).PURCHASE_ORDER; const orderNo=formatAutoDocumentNo(numberRule,await tx.purchaseOrder.count({where:{orderNo:{startsWith:autoDocumentPrefix(numberRule)}}}));
      const order = await tx.purchaseOrder.create({ data: { orderNo, supplierId: supplier.id, supplierNameSnapshot: supplier.name, orderDate: new Date(), status: "DRAFT", remark: String(body.remark || "多来源采购需求合并"), createdById: user.id } });
      for (const [materialId, allocations] of grouped) {
        const material = allocations[0].demand.material;
        const quantity = allocations.reduce((sum, row) => sum.add(row.quantity), new Prisma.Decimal(0));
        const unitPrice = new Prisma.Decimal(String(body.unitPrices?.[materialId] || material.standardPrice || 0));
        const item = await tx.purchaseOrderItem.create({ data: { purchaseOrderId: order.id, materialId, materialCodeSnapshot: material.code, materialNameSnapshot: material.name, materialSpecSnapshot: material.spec, quantity, unitPrice, amount: quantity.mul(unitPrice), needArrivalDate: allocations.reduce((date, row) => row.demand.needByDate < date ? row.demand.needByDate : date, allocations[0].demand.needByDate), responsibleId: user.id } });
        for (const allocation of allocations) {
          await tx.purchaseOrderItemSource.create({ data: { purchaseOrderItemId: item.id, purchaseDemandId: allocation.demand.id, allocatedQuantity: allocation.quantity } });
          const converted = new Prisma.Decimal(allocation.demand.convertedQuantity).add(allocation.quantity);
          await tx.purchaseDemand.update({ where: { id: allocation.demand.id }, data: { convertedQuantity: converted, status: converted.gte(allocation.demand.suggestedQuantity) ? "CONVERTED" : "PARTIALLY_CONVERTED", activeSlot: converted.gte(allocation.demand.suggestedQuantity) ? null : true } });
        }
      }
      const created = await tx.purchaseOrder.findUnique({ where: { id: order.id } });
      await writeOperationLog(tx, { userId: user.id, action: "CONVERT_PURCHASE_DEMANDS", entityType: "PurchaseOrder", entityId: order.id, afterData: { order: created, demandIds } });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(created, { status: 201 });
  } catch (error: any) { return NextResponse.json({ error: error?.code === "P2002" ? "采购需求正在被其他操作转换，请刷新后重试" : error?.message || "转换失败" }, { status: 409 }); }
}
