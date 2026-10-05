export const PRINT_PAGE_SIZE = 100;
export const PRINT_RESULT_LIMIT = 1000;

export type PrintPage<T> = {
  items: T[];
  total: number;
};

/**
 * 逐页取回当前筛选结果供原生打印使用。上限明确为 1000，避免浏览器打印时静默遗漏数据。
 */
export async function collectPrintResults<T>(
  fetchPage: (page: number, pageSize: number) => Promise<PrintPage<T>>,
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let page = 1;
  let total = 0;

  while (items.length < PRINT_RESULT_LIMIT) {
    const result = await fetchPage(page, PRINT_PAGE_SIZE);
    const pageItems = Array.isArray(result.items) ? result.items : [];
    total = Number.isFinite(result.total) ? Math.max(0, result.total) : 0;
    items.push(...pageItems.slice(0, PRINT_RESULT_LIMIT - items.length));

    if (items.length >= PRINT_RESULT_LIMIT || pageItems.length === 0 || (total > 0 && items.length >= total)) {
      return { items, truncated: items.length >= PRINT_RESULT_LIMIT && (total === 0 || total > PRINT_RESULT_LIMIT) };
    }
    page += 1;
  }

  return { items, truncated: items.length >= PRINT_RESULT_LIMIT && (total === 0 || total > PRINT_RESULT_LIMIT) };
}
