import { canSeeAllData, customerIsolationWhere, type SessionUser } from "@/lib/customer-permissions";

export const AFTER_SALES_ORDER_TYPES = ["NEW_MACHINE_DEBUG", "AFTER_SALES_REPAIR", "IN_WARRANTY_SERVICE", "OUT_WARRANTY_PAID"] as const;
export const AFTER_SALES_URGENCIES = ["NORMAL", "URGENT"] as const;
export const AFTER_SALES_STATUS = ["PENDING_DISPATCH", "DISPATCHED", "IN_PROGRESS", "COMPLETED", "CLOSED"] as const;
export const AFTER_SALES_PROBLEM_CATEGORIES = ["MECHANICAL", "ELECTRICAL", "SOFTWARE", "PRECISION", "OPERATION", "WEAR_PARTS", "OTHER"] as const;
export const AFTER_SALES_SATISFACTIONS = ["SATISFIED", "AVERAGE", "UNSATISFIED"] as const;

export type AfterSalesOrderType = (typeof AFTER_SALES_ORDER_TYPES)[number];
export type AfterSalesUrgency = (typeof AFTER_SALES_URGENCIES)[number];
export type AfterSalesStatus = (typeof AFTER_SALES_STATUS)[number];
export type AfterSalesProblemCategory = (typeof AFTER_SALES_PROBLEM_CATEGORIES)[number];
export type AfterSalesSatisfaction = (typeof AFTER_SALES_SATISFACTIONS)[number];

export const AFTER_SALES_ORDER_TYPE_LABELS: Record<AfterSalesOrderType, string> = {
  NEW_MACHINE_DEBUG: "新机调试",
  AFTER_SALES_REPAIR: "售后维修",
  IN_WARRANTY_SERVICE: "质保内服务",
  OUT_WARRANTY_PAID: "质保外有偿服务",
};
export const AFTER_SALES_STATUS_LABELS: Record<AfterSalesStatus, string> = {
  PENDING_DISPATCH: "待派发", DISPATCHED: "已派发", IN_PROGRESS: "处理中", COMPLETED: "已完成", CLOSED: "已关闭",
};
export const AFTER_SALES_PROBLEM_CATEGORY_LABELS: Record<AfterSalesProblemCategory, string> = {
  MECHANICAL: "机械故障", ELECTRICAL: "电气故障", SOFTWARE: "软件系统", PRECISION: "精度问题", OPERATION: "操作不当", WEAR_PARTS: "易损件损耗", OTHER: "其他",
};
export const AFTER_SALES_SATISFACTION_LABELS: Record<AfterSalesSatisfaction, string> = {
  SATISFIED: "满意", AVERAGE: "一般", UNSATISFIED: "不满意",
};

export const DEFAULT_AFTER_SALES_ALERT_DAYS: Record<AfterSalesOrderType, number> = {
  NEW_MACHINE_DEBUG: 3,
  AFTER_SALES_REPAIR: 5,
  IN_WARRANTY_SERVICE: 5,
  OUT_WARRANTY_PAID: 7,
};

export type AfterSalesPrintInfo = { companyName: string; contactAddress: string; footerNote: string };

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeAfterSalesReminderConfig(value: unknown) {
  const source = objectValue(value);
  const rawDays = objectValue(source.afterSalesAlertDays);
  return {
    ...source,
    afterSalesAlertDays: Object.fromEntries(AFTER_SALES_ORDER_TYPES.map((orderType) => [orderType, alertDaysForAfterSalesOrder(orderType, "NORMAL", rawDays)])),
  };
}

export function normalizeAfterSalesPrintInfo(value: unknown): Record<string, unknown> & { afterSalesPrintInfo: AfterSalesPrintInfo } {
  const source = objectValue(value);
  const raw = objectValue(source.afterSalesPrintInfo);
  const text = (field: keyof AfterSalesPrintInfo) => typeof raw[field] === "string" ? raw[field].trim().slice(0, 500) : "";
  return { ...source, afterSalesPrintInfo: { companyName: text("companyName"), contactAddress: text("contactAddress"), footerNote: text("footerNote") } };
}

export function canAccessAfterSales(user: SessionUser) {
  return ["SUPER_ADMIN", "SALES", "FOREIGN_TRADE"].includes(user.role);
}

/** 订单通过客户关联复用 CRM 的业务线和省市范围，不给销售角色开放 ERP 数据。 */
export function afterSalesOrderWhere(user: SessionUser) {
  return {
    deletedAt: null,
    customer: canSeeAllData(user) ? {} : customerIsolationWhere(user),
  };
}

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function optionalAmount(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("服务金额必须为大于等于 0 的数字");
  return amount;
}

export function validateAfterSalesOrderInput(input: { orderType?: unknown; serviceAmount?: unknown }) {
  if (!isOneOf(input.orderType, AFTER_SALES_ORDER_TYPES)) throw new Error("工单类型无效");
  const serviceAmount = optionalAmount(input.serviceAmount);
  if (input.orderType === "OUT_WARRANTY_PAID" && serviceAmount === null) throw new Error("质保外有偿服务必须填写服务金额");
  if (input.orderType !== "OUT_WARRANTY_PAID" && serviceAmount !== null) throw new Error("仅质保外有偿服务可填写服务金额");
  return { orderType: input.orderType, serviceAmount };
}

export function normalizeAfterSalesServiceAddress(value: unknown) {
  const serviceAddress = typeof value === "string" ? value.trim() : "";
  if (serviceAddress.length > 255) throw new Error("服务地址不能超过 255 个字符");
  return serviceAddress || null;
}

export function normalizeAfterSalesSatisfaction(value: unknown): AfterSalesSatisfaction | null {
  if (value === null || value === undefined || value === "") return null;
  if (!isOneOf(value, AFTER_SALES_SATISFACTIONS)) throw new Error("满意度无效");
  return value;
}

export function validateAfterSalesReceipt(input: { completedDate?: unknown; receiptContent?: unknown; problemCategory?: unknown; otherReason?: unknown; satisfaction?: unknown }) {
  const completedDate = typeof input.completedDate === "string" ? input.completedDate.trim() : "";
  const receiptContent = typeof input.receiptContent === "string" ? input.receiptContent.trim() : "";
  if (!completedDate) throw new Error("完成时间必填");
  if (!receiptContent) throw new Error("回执内容必填");
  if (!isOneOf(input.problemCategory, AFTER_SALES_PROBLEM_CATEGORIES)) throw new Error("问题分类无效");
  const otherReason = typeof input.otherReason === "string" ? input.otherReason.trim() : "";
  if (input.problemCategory === "OTHER" && !otherReason) throw new Error("选择其他原因时必须填写具体原因");
  return {
    completedDate,
    receiptContent,
    problemCategory: input.problemCategory,
    otherReason: input.problemCategory === "OTHER" ? otherReason : null,
    satisfaction: normalizeAfterSalesSatisfaction(input.satisfaction),
  };
}

export function canTransitionAfterSalesStatus(current: AfterSalesStatus, next: AfterSalesStatus, hasSignedAttachment: boolean) {
  if (current === "PENDING_DISPATCH") return next === "DISPATCHED";
  if (current === "DISPATCHED") return next === "IN_PROGRESS";
  if (current === "IN_PROGRESS") return next === "COMPLETED";
  if (current === "COMPLETED") return next === "CLOSED" && hasSignedAttachment;
  return false;
}

export function alertDaysForAfterSalesOrder(orderType: AfterSalesOrderType, urgency: AfterSalesUrgency, configured?: Partial<Record<AfterSalesOrderType, unknown>>) {
  const raw = Number(configured?.[orderType]);
  const normalDays = Number.isInteger(raw) && raw >= 1 && raw <= 365 ? raw : DEFAULT_AFTER_SALES_ALERT_DAYS[orderType];
  return urgency === "URGENT" ? Math.max(1, Math.floor(normalDays / 2)) : normalDays;
}

export function afterSalesOrderIsOverdue(order: { dispatchDate: Date | string; orderType: AfterSalesOrderType; urgency: AfterSalesUrgency; status: AfterSalesStatus }, now = new Date(), configured?: Partial<Record<AfterSalesOrderType, unknown>>) {
  if (["COMPLETED", "CLOSED"].includes(order.status)) return false;
  const deadline = new Date(order.dispatchDate);
  deadline.setDate(deadline.getDate() + alertDaysForAfterSalesOrder(order.orderType, order.urgency, configured));
  return now.getTime() > deadline.getTime();
}

export function afterSalesOrderAlertState(order: { dispatchDate: Date | string; orderType: AfterSalesOrderType; urgency: AfterSalesUrgency; status: AfterSalesStatus }, now = new Date(), configured?: Partial<Record<AfterSalesOrderType, unknown>>) {
  if (["COMPLETED", "CLOSED"].includes(order.status)) return "normal" as const;
  const deadline = new Date(order.dispatchDate);
  deadline.setDate(deadline.getDate() + alertDaysForAfterSalesOrder(order.orderType, order.urgency, configured));
  if (now.getTime() > deadline.getTime()) return "danger" as const;
  const warningAt = new Date(deadline); warningAt.setDate(warningAt.getDate() - 1);
  return now.getTime() >= warningAt.getTime() ? "warning" as const : "normal" as const;
}

/** BOM 物料与手工补充配件只向售后模块返回去重后的名称快照。 */
export function mergeAfterSalesPartNames(bomPartNames: readonly string[], supplementPartNames: readonly string[]) {
  return [...new Set([...bomPartNames, ...supplementPartNames].map((name) => name.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN"));
}

export function isPrismaUniqueError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002");
}
