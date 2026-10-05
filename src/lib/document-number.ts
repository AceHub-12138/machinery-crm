export const DOCUMENT_NUMBER_RULES_KEY = "documentNumberRules";

export type AutoDocumentKind = "PURCHASE_ORDER" | "STOCK_CHECK" | "STOCK_TRANSFER" | "STOCK_OUT" | "AFTER_SALES_ORDER";
export type AutoDocumentRule = { prefix: string; dateFormat: "yyyyMMdd"; sequenceLength: number; separator: string; resetCycle: "DAY" };
export type AutoDocumentRules = Record<AutoDocumentKind, AutoDocumentRule>;

export const DEFAULT_AUTO_DOCUMENT_RULES: AutoDocumentRules = {
  PURCHASE_ORDER: { prefix: "PO", dateFormat: "yyyyMMdd", sequenceLength: 3, separator: "", resetCycle: "DAY" },
  STOCK_CHECK: { prefix: "CK", dateFormat: "yyyyMMdd", sequenceLength: 3, separator: "", resetCycle: "DAY" },
  STOCK_TRANSFER: { prefix: "TR", dateFormat: "yyyyMMdd", sequenceLength: 3, separator: "", resetCycle: "DAY" },
  STOCK_OUT: { prefix: "CH", dateFormat: "yyyyMMdd", sequenceLength: 3, separator: "", resetCycle: "DAY" },
  AFTER_SALES_ORDER: { prefix: "SH", dateFormat: "yyyyMMdd", sequenceLength: 3, separator: "-", resetCycle: "DAY" },
};

export function documentDateToken(date = new Date()) { return date.toISOString().slice(0, 10).replace(/-/g, ""); }

export function normalizeAutoDocumentRules(value: unknown): AutoDocumentRules {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries((Object.keys(DEFAULT_AUTO_DOCUMENT_RULES) as AutoDocumentKind[]).map((kind) => {
    const input = source[kind] && typeof source[kind] === "object" && !Array.isArray(source[kind]) ? source[kind] as Record<string, unknown> : {};
    const fallback = DEFAULT_AUTO_DOCUMENT_RULES[kind];
    const configuredPrefix = String(input.prefix ?? fallback.prefix).trim();
    const prefix = ["STOCK_OUT", "AFTER_SALES_ORDER"].includes(kind) && !configuredPrefix ? fallback.prefix : configuredPrefix;
    const dateFormat = input.dateFormat === "yyyyMMdd" ? input.dateFormat : fallback.dateFormat;
    const sequenceLength = Number.isInteger(input.sequenceLength) && Number(input.sequenceLength) >= 1 && Number(input.sequenceLength) <= 8 ? Number(input.sequenceLength) : fallback.sequenceLength;
    const separator = typeof input.separator === "string" && input.separator.length <= 3 ? input.separator : fallback.separator;
    const resetCycle = input.resetCycle === "DAY" ? input.resetCycle : fallback.resetCycle;
    return [kind, { prefix, dateFormat, sequenceLength, separator, resetCycle }];
  })) as AutoDocumentRules;
}

export function assertAutoDocumentRules(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("编号规则必须是对象");
  for (const kind of Object.keys(value as object)) {
    if (!(kind in DEFAULT_AUTO_DOCUMENT_RULES)) throw new Error("不允许配置该单据类型");
    const rule = (value as Record<string, unknown>)[kind];
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) throw new Error("编号规则格式无效");
    const input = rule as Record<string, unknown>;
    for (const field of Object.keys(input)) if (!["prefix", "dateFormat", "sequenceLength", "separator", "resetCycle"].includes(field)) throw new Error("编号规则只允许修改前缀、日期格式、流水位数、分隔符和重置周期");
    if (kind === "STOCK_OUT" && typeof input.prefix === "string" && !input.prefix.trim()) throw new Error("出库单自动编号前缀不能为空");
    if (kind === "AFTER_SALES_ORDER" && typeof input.prefix === "string" && !input.prefix.trim()) throw new Error("售后工单自动编号前缀不能为空");
  }
  return normalizeAutoDocumentRules(value);
}

export function autoDocumentPrefix(rule: AutoDocumentRule, date = new Date()) { return `${rule.prefix}${documentDateToken(date)}${rule.separator}`; }

/** 历史随机后缀不可解析；严格按当日同前缀已有数量加一。 */
export function nextDailySequenceFromCount(existingCount: number) { return Math.max(0, existingCount) + 1; }
export function formatAutoDocumentNo(rule: AutoDocumentRule, existingCount: number, date = new Date()) { return `${autoDocumentPrefix(rule, date)}${String(nextDailySequenceFromCount(existingCount)).padStart(rule.sequenceLength, "0")}`; }

export function stockInAutoNumberPrefix(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}${part("month")}${part("day")}`;
}

export function formatStockInAutoNumber(existingBatchNos: readonly string[], date = new Date()) {
  const prefix = stockInAutoNumberPrefix(date);
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  const sequence = existingBatchNos.reduce((max, batchNo) => {
    const match = pattern.exec(batchNo);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${prefix}${String(sequence + 1).padStart(2, "0")}`;
}

export function resolveStockInBatchNo(manualBatchNo: string | null, existingBatchNos: readonly string[], date = new Date()) {
  return manualBatchNo || formatStockInAutoNumber(existingBatchNos, date);
}

export function stockOutAutoNumberPrefix(rule: AutoDocumentRule, date = new Date()) {
  return `${rule.prefix}${stockInAutoNumberPrefix(date)}${rule.separator}`;
}

export function formatStockOutAutoNumber(rule: AutoDocumentRule, existingBatchNos: readonly string[], date = new Date()) {
  const prefix = stockOutAutoNumberPrefix(rule, date);
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`);
  const sequence = existingBatchNos.reduce((max, batchNo) => {
    const match = pattern.exec(batchNo);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${prefix}${String(sequence + 1).padStart(rule.sequenceLength, "0")}`;
}

export function resolveStockOutBatchNo(manualBatchNo: string | null, rule: AutoDocumentRule, existingBatchNos: readonly string[], date = new Date()) {
  return manualBatchNo || formatStockOutAutoNumber(rule, existingBatchNos, date);
}

export function afterSalesOrderNumberPrefix(rule: AutoDocumentRule, date = new Date()) {
  return `${rule.prefix}${rule.prefix.endsWith("-") ? "" : "-"}${stockInAutoNumberPrefix(date)}${rule.separator}`;
}

/** 同日前缀下取最大流水号，删除中间工单也不会产生重复编号。 */
export function formatAfterSalesOrderNo(rule: AutoDocumentRule, existingOrderNos: readonly string[], date = new Date()) {
  const prefix = afterSalesOrderNumberPrefix(rule, date);
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`);
  const sequence = existingOrderNos.reduce((max, orderNo) => {
    const match = pattern.exec(orderNo);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${prefix}${String(sequence + 1).padStart(rule.sequenceLength, "0")}`;
}
