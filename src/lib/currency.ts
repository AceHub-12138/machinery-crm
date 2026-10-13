export type CurrencyAmount = { currency: string; amount: string | number };
export type MoneyRecord = { currency?: string; amount?: unknown; paidAmount?: unknown; unpaidAmount?: unknown };
export const MONEY_METRICS = ["periodContractAmount", "periodPaidAmount", "periodUnpaidAmount", "totalContractAmount", "totalPaidAmount", "totalUnpaidAmount"] as const;
export type MoneyMetric = typeof MONEY_METRICS[number];
export type DashboardAmounts = Partial<Record<MoneyMetric, CurrencyAmount[]>>;

/** 内部业务金额；公开大屏继续使用独立的固定人民币格式。 */
export function formatMoney(value: unknown, currency = "CNY", minimumFractionDigits = 0): string {
  if (value === null || value === undefined || value === "") return "-";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "-";
  const prefix = currency === "CNY" ? "¥" : currency === "EUR" ? "€" : `${currency} `;
  return `${prefix}${amount.toLocaleString("zh-CN", { minimumFractionDigits, maximumFractionDigits: 2 })}`;
}

/** 历史快照未保存币种；不能用产品当前币种重解释历史数值。 */
export function formatPriceSnapshot(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  return `${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}（币种待确认）`;
}

export function sortCurrencyAmounts(rows: CurrencyAmount[]): CurrencyAmount[] {
  return [...rows].sort((a, b) => a.currency === b.currency ? 0 : a.currency === "CNY" ? -1 : b.currency === "CNY" ? 1 : a.currency.localeCompare(b.currency));
}

/** 旧平台无分组字段时仅回退人民币；新平台空数组也不读旧的混合金额。 */
export function dashboardAmounts(groups: DashboardAmounts | undefined, metric: MoneyMetric, legacyValue: unknown): CurrencyAmount[] {
  const rows = groups?.[metric];
  return Array.isArray(rows) ? rows : [{ currency: "CNY", amount: Number(legacyValue || 0) }];
}

/** 客户/列表前端求和用整数分，避免 0.1 + 0.2 的尾差；记录缺字段兼容旧 CNY API。 */
export function sumByCurrency(records: MoneyRecord[], field: "amount" | "paidAmount" | "unpaidAmount" = "amount"): CurrencyAmount[] {
  const cents = new Map<string, bigint>();
  for (const record of records) {
    const currency = record.currency ?? "CNY";
    const value = Number(record[field] ?? 0);
    if (!Number.isFinite(value)) continue;
    cents.set(currency, (cents.get(currency) ?? BigInt(0)) + BigInt(Math.round(value * 100)));
  }
  return sortCurrencyAmounts([...cents].map(([currency, value]) => ({ currency, amount: `${value < BigInt(0) ? "-" : ""}${(value < BigInt(0) ? -value : value) / BigInt(100)}.${String((value < BigInt(0) ? -value : value) % BigInt(100)).padStart(2, "0")}` })));
}

/** 每个币种都收齐才算收齐，外币多收不能抵消人民币欠款。 */
export function contractPaymentLabel(records: MoneyRecord[]): string {
  const totals = sumByCurrency(records);
  const paid = new Map(sumByCurrency(records, "paidAmount").map(row => [row.currency, Number(row.amount)]));
  const payable = totals.filter(row => Number(row.amount) > 0);
  if (!payable.length) return "-";
  if (payable.every(row => (paid.get(row.currency) ?? 0) >= Number(row.amount))) return "已回款";
  return [...paid.values()].some(value => value > 0) ? "部分回款" : "未回款";
}

export function currencyLines(rows: CurrencyAmount[]) {
  const ordered = sortCurrencyAmounts(rows);
  const primary = ordered.find(row => row.currency === "CNY") ?? { currency: "CNY", amount: 0 };
  const foreign = ordered.filter(row => row.currency !== "CNY" && Number(row.amount) !== 0);
  const visible = foreign.length > 2 ? foreign.slice(0, 1) : foreign;
  return {
    primary: formatMoney(primary.amount, "CNY"),
    foreign: visible.map(row => `+ ${formatMoney(row.amount, row.currency)}${foreign.length > 2 ? ` 等 ${foreign.length} 种` : ""}`),
    title: [formatMoney(primary.amount, "CNY"), ...foreign.map(row => `+ ${formatMoney(row.amount, row.currency)}`)].join("\n"),
  };
}
