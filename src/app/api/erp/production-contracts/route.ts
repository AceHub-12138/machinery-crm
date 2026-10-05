import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canPublishProductionOrder, getSessionUser } from "@/lib/permissions";
import { calculateRemainingContractQuantity } from "@/lib/production-orders";
import { findProductionContractIds } from "@/lib/production-contract-search";

// This selector deliberately returns production fields only. Customer, contact,
// address, invoicing, amount and payment data must never cross this interface.
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canPublishProductionOrder(user)) return NextResponse.json({ error: "无权限读取合同生产明细" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() || "";
  const contractId = searchParams.get("contractId")?.trim() || "";
  const excludeOrderId = searchParams.get("excludeOrderId")?.trim() || "";
  const matchingIds = await findProductionContractIds(search);
  const contracts = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      contractStatus: "SIGNED",
      ...(contractId ? { id: contractId } : {}),
      ...(matchingIds ? { id: { in: matchingIds } } : {}),
    },
    select: {
      id: true,
      contractNo: true,
      estimatedShipmentDate: true,
      salesUser: { select: { id: true, name: true, email: true } },
      items: {
        where: { itemType: "MAIN" },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          productId: true,
          productNameSnapshot: true,
          productModelSnapshot: true,
          quantity: true,
          sortOrder: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: contractId ? 1 : 50,
  });

  const itemIds = contracts.flatMap((contract) => contract.items.map((item) => item.id));
  const productIds = contracts.flatMap((contract) => contract.items.map((item) => item.productId));
  const [generatedGroups, legacyGeneratedGroups, boms] = await Promise.all([
    itemIds.length
      ? prisma.productionOrder.groupBy({
          by: ["contractItemId"],
          where: {
            contractItemId: { in: itemIds },
            deletedAt: null,
            isCurrent: true,
            status: { not: "CANCELLED" },
            ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
          },
          _sum: { quantity: true },
        })
      : [],
    contracts.length
      ? prisma.productionOrder.groupBy({
          by: ["contractId", "productId"],
          where: {
            contractId: { in: contracts.map((contract) => contract.id) },
            contractItemId: null,
            deletedAt: null,
            isCurrent: true,
            status: { not: "CANCELLED" },
            ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
          },
          _sum: { quantity: true },
        })
      : [],
    productIds.length
      ? prisma.bomHeader.findMany({
          where: { productId: { in: [...new Set(productIds)] }, isActive: true },
          select: { id: true, productId: true, version: true },
          orderBy: { updatedAt: "desc" },
        })
      : [],
  ]);
  const generatedByItem = new Map(
    generatedGroups.map((group) => [group.contractItemId, group._sum.quantity || new Prisma.Decimal(0)])
  );
  const legacyGeneratedByContractProduct = new Map(
    legacyGeneratedGroups.map((group) => [
      `${group.contractId}:${group.productId}`,
      group._sum.quantity || new Prisma.Decimal(0),
    ])
  );
  const bomsByProduct = new Map<string, typeof boms>();
  for (const bom of boms) bomsByProduct.set(bom.productId, [...(bomsByProduct.get(bom.productId) || []), bom]);

  return NextResponse.json(contracts.map((contract) => ({
    ...contract,
    items: contract.items.map((item) => {
      const linkedQuantity = generatedByItem.get(item.id) || new Prisma.Decimal(0);
      const sameProductItemCount = contract.items.filter((candidate) => candidate.productId === item.productId).length;
      const legacyQuantity = legacyGeneratedByContractProduct.get(`${contract.id}:${item.productId}`) || new Prisma.Decimal(0);
      const hasAmbiguousLegacySource = sameProductItemCount > 1 && legacyQuantity.gt(0);
      const generatedQuantity = linkedQuantity.add(sameProductItemCount === 1 ? legacyQuantity : 0);
      const remainingQuantity = calculateRemainingContractQuantity(item.quantity, [generatedQuantity]);
      return {
        ...item,
        generatedQuantity: generatedQuantity.toNumber(),
        remainingQuantity: hasAmbiguousLegacySource ? 0 : remainingQuantity.toNumber(),
        canGenerate: !hasAmbiguousLegacySource && remainingQuantity.gt(0),
        disabledReason: hasAmbiguousLegacySource
          ? "该合同同一机型存在多条设备明细，且历史工单未关联具体合同明细，请先核对历史来源"
          : remainingQuantity.gt(0) ? null : "该合同设备已全部生成生产工单",
        boms: bomsByProduct.get(item.productId) || [],
      };
    }),
  })));
}
