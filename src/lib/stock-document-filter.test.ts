import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("stock document creator and derived-status filters", () => {
  for (const documentType of ["stock-in", "stock-out"]) {
    it(`${documentType} keeps the existing filters and uses the current status authority`, () => {
      const route = read(`src/app/api/erp/${documentType}/route.ts`);
      expect(route).toContain('searchParams.get("createdById")');
      expect(route).toContain("where.createdById = createdById");
      expect(route).toContain('status === "CONFIRMED"');
      if (documentType === "stock-in") {
        expect(route).toContain('status === "VOIDED"');
        expect(route).toContain("where.status = status");
      } else {
        expect(route).toContain("where.confirmedAt = { not: null }");
      }
      expect(route).toContain('searchParams.get("dateFrom")');
      expect(route).toContain('searchParams.get("dateTo")');
      expect(route).toContain('searchParams.get("search")');
    });

    it(`${documentType} filter controls submit creator and derived status`, () => {
      const page = read(`src/app/(app)/erp/${documentType}/page.tsx`);
      expect(page).toContain('params.set("createdById", filterCreatorId)');
      expect(page).toContain('params.set("status", filterStatus)');
      expect(page).toContain("全部创建人");
      expect(page).toContain("已确认");
    });
  }

  it("exposes only the safe creator summary", () => {
    const route = read("src/app/api/erp/document-creators/route.ts");
    expect(route).toContain("select: { id: true, name: true }");
    expect(route).not.toMatch(/(password|email|phone)\s*:/i);
  });

  it("allows an empty stock-in number and retains number search", () => {
    const page = read("src/app/(app)/erp/stock-in/page.tsx");
    const route = read("src/app/api/erp/stock-in/route.ts");
    expect(page).toContain("留空自动生成（如 2026081101）");
    expect(page).not.toContain("!batchNo.trim()");
    expect(route).toContain("resolveStockInBatchNo");
    expect(route).toContain('{ batchNo: { contains: search } }');
  });
});
