export const AFTER_SALES_CONTRACT_SEARCH_DEBOUNCE_MS = 300;

/** 在输入停止约 300ms 后再请求合同，避免每个按键都触发接口调用。 */
export function scheduleAfterSalesContractSearch(callback: () => void, delay = AFTER_SALES_CONTRACT_SEARCH_DEBOUNCE_MS) {
  return setTimeout(callback, delay);
}

/** 仅使用当前合同接口返回的配件名称做本地匹配，手输新名称不受限制。 */
export function filterAfterSalesPartOptions(options: readonly string[], query: string) {
  const keyword = query.trim().toLocaleLowerCase("zh-CN");
  if (!keyword) return [];
  return options.filter((option) => option.toLocaleLowerCase("zh-CN").includes(keyword));
}

/** 将金额输入收敛为非负整数或最多一位小数，避免产生两位小数。 */
export function normalizeServiceAmountInput(value: string) {
  if (!value) return "";
  const [integerPart, ...decimalParts] = value.replace(/[^\d.]/g, "").split(".");
  const decimalPart = decimalParts.join("").slice(0, 1);
  return decimalParts.length ? `${integerPart || "0"}.${decimalPart}` : integerPart;
}

/** 金额步进按钮固定按整数增减，保留用户已输入的一位小数。 */
export function adjustServiceAmount(value: string, delta: 1 | -1) {
  const amount = Number(normalizeServiceAmountInput(value));
  const nextAmount = Math.max(0, (Number.isFinite(amount) ? amount : 0) + delta);
  return normalizeServiceAmountInput(String(Math.round(nextAmount * 10) / 10));
}
