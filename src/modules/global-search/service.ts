import { canAccessCrmDashboard } from "@/lib/dashboard-access";
import { prisma } from "@/lib/db";
import { canViewERP } from "@/lib/erp-roles";
import {
  buildCustomerWhereClause,
  canSeeAllData,
  customerIsolationWhere,
  type SessionUser,
} from "@/lib/permissions";
import { afterSalesOrderWhere, canAccessAfterSales } from "@/lib/after-sales";

import { filterNavForRole, getAllNavItems } from "./nav-index";
import type { SearchResult, SearchResultType } from "./types";

function searchNavigation(keyword: string, role: string): SearchResult[] {
  const normalizedKeyword = keyword.toLocaleLowerCase("zh-CN");
  return filterNavForRole(getAllNavItems(), role)
    .filter((item) =>
      `${item.label} ${item.href}`
        .toLocaleLowerCase("zh-CN")
        .includes(normalizedKeyword),
    )
    .slice(0, 12)
    .map((item) => ({
      type: "nav",
      id: `${item.href}:${item.label}`,
      title: item.label,
      href: item.href,
      group: item.group,
    }));
}

// MySQL string matching follows the database collation; this schema's generated
// Prisma StringFilter does not expose the PostgreSQL-only `mode` option.
async function searchCustomers(
  keyword: string,
  user: SessionUser,
): Promise<SearchResult[]> {
  if (!canAccessCrmDashboard(user.role)) return [];

  try {
    const rows = await prisma.customer.findMany({
      where: {
        ...(canSeeAllData(user)
          ? { deletedAt: null }
          : buildCustomerWhereClause(user)),
        AND: [{
          OR: [
            { companyName: { contains: keyword } },
            { contactName: { contains: keyword } },
            { phone: { contains: keyword } },
            { province: { contains: keyword } },
            { city: { contains: keyword } },
          ],
        }],
      },
      select: {
        id: true,
        companyName: true,
        contactName: true,
        phone: true,
        province: true,
        city: true,
      },
      take: 8,
    });
    return rows.map((customer) => ({
      type: "customer",
      id: customer.id,
      title: customer.companyName,
      subtitle: [
        customer.contactName,
        customer.phone,
        [customer.province, customer.city].filter(Boolean).join(""),
      ].filter(Boolean).join(" · "),
      href: "/customers",
      group: "客户",
    }));
  } catch {
    return [];
  }
}

async function searchContracts(
  keyword: string,
  user: SessionUser,
): Promise<SearchResult[]> {
  if (!canAccessCrmDashboard(user.role)) return [];

  try {
    const rows = await prisma.contract.findMany({
      where: {
        deletedAt: null,
        customer: canSeeAllData(user)
          ? {}
          : { ...customerIsolationWhere(user) },
        OR: [
          { contractNo: { contains: keyword } },
          { customer: { companyName: { contains: keyword } } },
        ],
      },
      select: {
        id: true,
        contractNo: true,
        amount: true,
        customer: { select: { companyName: true } },
      },
      take: 8,
    });
    return rows.map((contract) => ({
      type: "contract",
      id: contract.id,
      title: contract.contractNo,
      subtitle: `${contract.customer.companyName} · ¥${contract.amount.toString()}`,
      href: "/contracts",
      group: "合同",
    }));
  } catch {
    return [];
  }
}

async function searchProducts(keyword: string): Promise<SearchResult[]> {
  try {
    const rows = await prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { model: { contains: keyword } },
          { category: { contains: keyword } },
          { remark: { contains: keyword } },
        ],
      },
      select: { id: true, model: true, category: true, productType: true },
      take: 8,
    });
    return rows.map((product) => ({
      type: "product",
      id: product.id,
      title: product.model,
      subtitle: `${product.category} · ${product.productType}`,
      href: "/products",
      group: "产品",
    }));
  } catch {
    return [];
  }
}

async function searchMaterials(
  keyword: string,
  role: string,
): Promise<SearchResult[]> {
  if (!canViewERP(role)) return [];

  try {
    const rows = await prisma.material.findMany({
      where: {
        deletedAt: null,
        OR: [
          { code: { contains: keyword } },
          { name: { contains: keyword } },
          { spec: { contains: keyword } },
        ],
      },
      select: { id: true, code: true, name: true, spec: true },
      take: 8,
    });
    return rows.map((material) => ({
      type: "material",
      id: material.id,
      title: material.name,
      subtitle: [material.code, material.spec].filter(Boolean).join(" · "),
      href: "/erp/materials",
      group: "物料",
    }));
  } catch {
    return [];
  }
}

async function searchPurchaseOrders(
  keyword: string,
  role: string,
): Promise<SearchResult[]> {
  if (!canViewERP(role)) return [];

  try {
    const rows = await prisma.purchaseOrder.findMany({
      where: {
        deletedAt: null,
        OR: [
          { orderNo: { contains: keyword } },
          { supplierNameSnapshot: { contains: keyword } },
        ],
      },
      select: {
        id: true,
        orderNo: true,
        status: true,
        supplierNameSnapshot: true,
      },
      take: 8,
    });
    return rows.map((order) => ({
      type: "purchase-order",
      id: order.id,
      title: order.orderNo,
      subtitle: `${order.supplierNameSnapshot} · ${order.status}`,
      href: "/erp/purchase-orders",
      group: "采购订单",
    }));
  } catch {
    return [];
  }
}

async function searchProductionOrders(
  keyword: string,
  role: string,
): Promise<SearchResult[]> {
  if (!canViewERP(role)) return [];

  try {
    const rows = await prisma.productionOrder.findMany({
      where: {
        deletedAt: null,
        OR: [
          { orderNo: { contains: keyword } },
          { productModelSnapshot: { contains: keyword } },
          { productNameSnapshot: { contains: keyword } },
        ],
      },
      select: {
        id: true,
        orderNo: true,
        status: true,
        productModelSnapshot: true,
        productNameSnapshot: true,
      },
      take: 8,
    });
    return rows.map((order) => ({
      type: "production-order",
      id: order.id,
      title: order.orderNo,
      subtitle: `${order.productModelSnapshot} ${order.productNameSnapshot} · ${order.status}`,
      href: "/erp/production-orders",
      group: "生产工单",
    }));
  } catch {
    return [];
  }
}

async function searchAfterSalesOrders(
  keyword: string,
  user: SessionUser,
): Promise<SearchResult[]> {
  if (!canAccessAfterSales(user)) return [];
  try {
    const rows = await prisma.afterSalesOrder.findMany({
      where: {
        ...afterSalesOrderWhere(user),
        OR: [
          { orderNo: { contains: keyword } },
          { customerNameSnapshot: { contains: keyword } },
          { equipmentModelSnapshot: { contains: keyword } },
          { assigneeNames: { contains: keyword } },
        ],
      },
      select: { id: true, orderNo: true, customerNameSnapshot: true, equipmentModelSnapshot: true, assigneeNames: true, status: true },
      take: 8,
    });
    return rows.map((order) => ({
      type: "after-sales-order",
      id: order.id,
      title: order.orderNo,
      subtitle: `${order.customerNameSnapshot} · ${order.equipmentModelSnapshot} · ${order.assigneeNames}`,
      href: `/after-sales/${order.id}`,
      group: "售后工单",
    }));
  } catch {
    return [];
  }
}

export async function search(
  q: string,
  user: SessionUser,
  requestedType?: SearchResultType,
): Promise<{ results: SearchResult[] }> {
  const keyword = q.trim();
  if (keyword.length < 2) return { results: [] };

  const navigation = !requestedType || requestedType === "nav"
    ? searchNavigation(keyword, user.role)
    : [];
  const [customers, contracts, products, materials, purchaseOrders, productionOrders, afterSalesOrders] =
    await Promise.all([
      !requestedType || requestedType === "customer"
        ? searchCustomers(keyword, user)
        : Promise.resolve([]),
      !requestedType || requestedType === "contract"
        ? searchContracts(keyword, user)
        : Promise.resolve([]),
      !requestedType || requestedType === "product"
        ? searchProducts(keyword)
        : Promise.resolve([]),
      !requestedType || requestedType === "material"
        ? searchMaterials(keyword, user.role)
        : Promise.resolve([]),
      !requestedType || requestedType === "purchase-order"
        ? searchPurchaseOrders(keyword, user.role)
        : Promise.resolve([]),
      !requestedType || requestedType === "production-order"
        ? searchProductionOrders(keyword, user.role)
        : Promise.resolve([]),
      !requestedType || requestedType === "after-sales-order"
        ? searchAfterSalesOrders(keyword, user)
        : Promise.resolve([]),
    ]);

  return {
    results: [
      ...navigation,
      ...customers,
      ...contracts,
      ...products,
      ...materials,
      ...purchaseOrders,
      ...productionOrders,
      ...afterSalesOrders,
    ].slice(0, 40),
  };
}
