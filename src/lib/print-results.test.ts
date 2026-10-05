import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectPrintResults, PRINT_PAGE_SIZE, PRINT_RESULT_LIMIT } from "./print-results";

describe("collectPrintResults", () => {
  it("collects every page when the filtered result is within the limit", async () => {
    const result = await collectPrintResults(async (page, pageSize) => {
      expect(pageSize).toBe(PRINT_PAGE_SIZE);
      const source = Array.from({ length: 205 }, (_, index) => index + 1);
      return { items: source.slice((page - 1) * pageSize, page * pageSize), total: source.length };
    });

    expect(result.items).toHaveLength(205);
    expect(result.truncated).toBe(false);
  });

  it("keeps only the first 1000 results and reports the hard-limit warning", async () => {
    const total = PRINT_RESULT_LIMIT + 1;
    const result = await collectPrintResults(async (page, pageSize) => ({
      items: Array.from({ length: pageSize }, (_, index) => (page - 1) * pageSize + index),
      total,
    }));

    expect(result.items).toHaveLength(PRINT_RESULT_LIMIT);
    expect(result.truncated).toBe(true);
  });

  it("does not silently truncate when a malformed response omits its total", async () => {
    const result = await collectPrintResults(async (_page, pageSize) => ({
      items: Array.from({ length: pageSize }, (_, index) => index),
      total: 0,
    }));

    expect(result.items).toHaveLength(PRINT_RESULT_LIMIT);
    expect(result.truncated).toBe(true);
  });
});

describe("phase 4 print integration", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

  it("uses the same paginated, capped print path for all three pages", () => {
    for (const page of [
      "src/app/(app)/erp/stock-in/page.tsx",
      "src/app/(app)/erp/stock-out/page.tsx",
      "src/app/(app)/erp/inventory/page.tsx",
    ]) {
      const source = read(page);
      expect(source).toContain("collectPrintResults");
      expect(source).toContain('params.set("pageSize", String(printPageSize))');
      expect(source).toContain("结果超过1000条，仅打印前1000条，请收窄筛选条件");
      expect(source).toContain("window.print()");
    }
  });
});
