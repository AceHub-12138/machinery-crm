import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canSeeAllData, customerIsolationWhere, type SessionUser } from "@/lib/permissions";
import {
  AFTER_SALES_ORDER_TYPES,
  AFTER_SALES_PROBLEM_CATEGORIES,
  AFTER_SALES_STATUS,
  AFTER_SALES_URGENCIES,
  afterSalesOrderWhere,
  canAccessAfterSales,
  normalizeAfterSalesServiceAddress,
  validateAfterSalesOrderInput,
  type AfterSalesOrderType,
  type AfterSalesProblemCategory,
  type AfterSalesStatus,
  type AfterSalesUrgency,
} from "@/lib/after-sales";
import { afterSalesOrderNumberPrefix, DEFAULT_AUTO_DOCUMENT_RULES, DOCUMENT_NUMBER_RULES_KEY, formatAfterSalesOrderNo, normalizeAutoDocumentRules } from "@/lib/document-number";

export const afterSalesOrderInclude = {
  contract: { select: { id: true, contractNo: true, equipmentName: true, equipmentModel: true, salesUser: { select: { name: true } } } },
  customer: { select: { id: true, companyName: true, province: true, city: true } },
  createdBy: { select: { id: true, name: true } },
  parts: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.AfterSalesOrderInclude;

export function assertAfterSalesAccess(user: SessionUser) {
  if (!canAccessAfterSales(user)) throw new Error("无权限访问售后调试模块");
}

export function accessibleAfterSalesWhere(user: SessionUser, id: string) {
  return { id, ...afterSalesOrderWhere(user) };
}

export function optionalText(value: unknown, field: string, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new Error(`${field}必填`);
  return text || null;
}

export function dateOnly(value: unknown, field: string, required = true) {
  if (value === null || value === undefined || value === "") {
    if (required) throw new Error(`${field}必填`);
    return null;
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error(`${field}格式无效`);
  return date;
}

export function stringList(value: unknown, field: string) {
  if (!Array.isArray(value)) return [];
  const names = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  if (names.some((name) => name.length > 191)) throw new Error(`${field}名称不能超过 191 个字符`);
  return [...new Set(names)];
}

export function assertOrderType(value: unknown): AfterSalesOrderType {
  if (!(AFTER_SALES_ORDER_TYPES as readonly string[]).includes(String(value))) throw new Error("工单类型无效");
  return value as AfterSalesOrderType;
}

export function assertUrgency(value: unknown): AfterSalesUrgency {
  if (!(AFTER_SALES_URGENCIES as readonly string[]).includes(String(value))) throw new Error("紧急程度无效");
  return value as AfterSalesUrgency;
}

export function assertStatus(value: unknown): AfterSalesStatus {
  if (!(AFTER_SALES_STATUS as readonly string[]).includes(String(value))) throw new Error("工单状态无效");
  return value as AfterSalesStatus;
}

export function assertProblemCategory(value: unknown): AfterSalesProblemCategory {
  if (!(AFTER_SALES_PROBLEM_CATEGORIES as readonly string[]).includes(String(value))) throw new Error("问题分类无效");
  return value as AfterSalesProblemCategory;
}

export async function findAccessibleAfterSalesOrder(user: SessionUser, id: string) {
  assertAfterSalesAccess(user);
  return prisma.afterSalesOrder.findFirst({ where: accessibleAfterSalesWhere(user, id), include: afterSalesOrderInclude });
}

export async function findAccessibleContract(user: SessionUser, id: string) {
  assertAfterSalesAccess(user);
  return prisma.contract.findFirst({
    where: {
      id,
      deletedAt: null,
      customer: canSeeAllData(user) ? {} : customerIsolationWhere(user),
    },
    select: {
      id: true,
      contractNo: true,
      equipmentName: true,
      equipmentModel: true,
      productId: true,
      customerId: true,
      customer: { select: { companyName: true, province: true, city: true } },
      salesUser: { select: { name: true } },
    },
  });
}

export async function configuredAfterSalesNumberRule(tx: Prisma.TransactionClient) {
  const setting = await tx.systemSetting.findUnique({ where: { key: DOCUMENT_NUMBER_RULES_KEY }, select: { value: true } });
  return normalizeAutoDocumentRules(setting?.value).AFTER_SALES_ORDER || DEFAULT_AUTO_DOCUMENT_RULES.AFTER_SALES_ORDER;
}

export { isPrismaUniqueError } from "@/lib/after-sales";

export type AfterSalesListFilters = {
  status?: AfterSalesStatus;
  orderType?: AfterSalesOrderType;
  urgency?: AfterSalesUrgency;
  equipmentModel?: string;
  assigneeName?: string;
  keyword?: string;
  dateFrom?: Date | null;
  dateTo?: Date | null;
};

export function afterSalesListWhere(user: SessionUser, filters: AfterSalesListFilters): Prisma.AfterSalesOrderWhereInput {
  const where: Prisma.AfterSalesOrderWhereInput = afterSalesOrderWhere(user);
  if (filters.status) where.status = filters.status;
  if (filters.orderType) where.orderType = filters.orderType;
  if (filters.urgency) where.urgency = filters.urgency;
  if (filters.equipmentModel) where.equipmentModelSnapshot = { contains: filters.equipmentModel };
  if (filters.assigneeName) where.assigneeNames = { contains: filters.assigneeName };
  if (filters.dateFrom || filters.dateTo) where.dispatchDate = { ...(filters.dateFrom ? { gte: filters.dateFrom } : {}), ...(filters.dateTo ? { lte: filters.dateTo } : {}) };
  if (filters.keyword) where.OR = [
    { orderNo: { contains: filters.keyword } },
    { customerNameSnapshot: { contains: filters.keyword } },
    { equipmentModelSnapshot: { contains: filters.keyword } },
    { assigneeNames: { contains: filters.keyword } },
    { contractNoSnapshot: { contains: filters.keyword } },
  ];
  return where;
}

export function afterSalesOrderPayload(body: Record<string, unknown>) {
  const orderType = assertOrderType(body.orderType);
  const { serviceAmount } = validateAfterSalesOrderInput({ orderType, serviceAmount: body.serviceAmount });
  return {
    orderType,
    urgency: assertUrgency(body.urgency || "NORMAL"),
    dispatchDate: dateOnly(body.dispatchDate, "派发时间")!,
    serviceAmount,
    assigneeNames: optionalText(body.assigneeNames, "售后人员", true)!,
    serviceAddress: normalizeAfterSalesServiceAddress(body.serviceAddress),
    description: optionalText(body.description, "工单说明", true)!,
    partNames: stringList(body.partNames, "配件"),
  };
}

export async function nextAfterSalesOrderNo(tx: Prisma.TransactionClient, date = new Date()) {
  const rule = await configuredAfterSalesNumberRule(tx);
  const prefix = afterSalesOrderNumberPrefix(rule, date);
  const existing = await tx.afterSalesOrder.findMany({ where: { orderNo: { startsWith: prefix } }, select: { orderNo: true } });
  return formatAfterSalesOrderNo(rule, existing.map((row) => row.orderNo), date);
}
