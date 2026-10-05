import { prisma } from "@/lib/db";
import { canAccessERP, canManageInventory, type SessionUser } from "@/lib/permissions";
import { isInventoryBelowWarningThreshold } from "@/lib/inventory-alert";
import { DomainError } from "@/modules/shared/domain-error";
import { writeOperationLog } from "@/lib/sales-items";

const materialSelect = {
  id: true,
  name: true,
  code: true,
  spec: true,
  unit: true,
  safetyStock: true,
  safetyStockEnabled: true,
  standardPrice: true,
  supplier: true,
  category: { select: { id: true, name: true, warningThreshold: true } },
} as const;

/** ERP 库存查询服务；权限在查询前判定，保留原 URL 和响应结构。 */
export async function listInventory(user: SessionUser, searchParams: URLSearchParams) {
  if (!canAccessERP(user)) throw new DomainError("无权限访问 ERP", 403);
  const search = searchParams.get("search") || "";
  const warehouseId = searchParams.get("warehouseId") || "";
  const categoryId = searchParams.get("categoryId") || "";
  const alertOnly = searchParams.get("alertOnly") === "1";
  const zeroStock = searchParams.get("zeroStock") === "1";
  const demandWithoutStock = searchParams.get("demandWithoutStock") === "1";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));
  const where: Record<string, unknown> = {};
  // 已删除物料的零库存行不进台账（软删除物料仍占库存行会形成"幽灵占位"）；
  // 若其名下还有真实库存则保留显示，避免在库数量从台账上消失。
  where.OR = [{ material: { deletedAt: null } }, { quantity: { not: 0 } }];
  if (warehouseId) where.warehouseId = warehouseId;
  if (categoryId) where.material = { categoryId };
  if (search) {
    where.material = { ...(where.material as object || {}), OR: [{ name: { contains: search } }, { code: { contains: search } }] };
  }
  if (zeroStock || demandWithoutStock) where.quantity = { equals: 0 };
  if (demandWithoutStock) {
    // 固定业务口径：未取消且 convertedQuantity < requestedQuantity；不使用 suggestedQuantity。
    const demands = await prisma.purchaseDemand.findMany({ where: { status: { not: "CANCELLED" } }, select: { materialId: true, requestedQuantity: true, convertedQuantity: true } });
    const materialIds = [...new Set(demands.filter((demand) => demand.convertedQuantity.lt(demand.requestedQuantity)).map((demand) => demand.materialId))];
    if (!materialIds.length) return { items: [], pagination: { page: 1, pageSize, total: 0, totalPages: 0 } };
    where.materialId = { in: materialIds };
  }
  if (alertOnly) {
    const inventories = await prisma.inventory.findMany({
      where,
      include: { warehouse: { select: { id: true, name: true, code: true } }, material: { select: materialSelect } },
      orderBy: { materialId: "asc" },
    });
    const items = inventories.filter((inventory) => {
      return isInventoryBelowWarningThreshold(inventory.quantity, inventory.material);
    });
    return { items, pagination: { page: 1, pageSize: items.length, total: items.length, totalPages: 1 } };
  }
  const skip = (page - 1) * pageSize;
  const [items, total] = await Promise.all([
    prisma.inventory.findMany({
      where,
      include: { warehouse: { select: { id: true, name: true, code: true } }, material: { select: materialSelect } },
      orderBy: { materialId: "asc" }, skip, take: pageSize,
    }),
    prisma.inventory.count({ where }),
  ]);
  return { items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

/**
 * 清除台账零库存结存行（仅限数量为 0 的行）。
 * 只删"当前结存"行，出入库单据/流水等历史不动；之后向同仓入库会自动重建行。
 * deleteMany 带 quantity=0 条件做原子复核，避免与并发出入库竞争。
 */
export async function clearZeroInventoryRow(user: SessionUser, inventoryId: string) {
  if (!canManageInventory(user)) throw new DomainError("无权限清除库存行", 403);

  const inventory = await prisma.inventory.findUnique({
    where: { id: inventoryId },
    select: {
      quantity: true,
      warehouse: { select: { name: true } },
      material: { select: { code: true, name: true } },
    },
  });
  if (!inventory) throw new DomainError("库存行不存在", 404);
  if (Number(inventory.quantity) !== 0) {
    throw new DomainError("该行库存数量已不是 0，不能清除", 409);
  }

  const deleted = await prisma.inventory.deleteMany({ where: { id: inventoryId, quantity: 0 } });
  if (deleted.count === 0) {
    throw new DomainError("库存数量刚发生变化，清除未执行，请刷新后重试", 409);
  }

  await writeOperationLog(prisma, {
    userId: user.id,
    action: "CLEAR_ZERO_INVENTORY_ROW",
    entityType: "Inventory",
    entityId: inventoryId,
    beforeData: {
      materialCode: inventory.material.code,
      materialName: inventory.material.name,
      warehouseName: inventory.warehouse.name,
      quantity: 0,
    },
  });

  return { success: true };
}
