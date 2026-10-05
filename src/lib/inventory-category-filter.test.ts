import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("inventory category filter", () => {
  it("loads the material category tree and passes the selected id to the existing inventory API", () => {
    const page = read("src/app/(app)/erp/inventory/page.tsx");
    expect(page).toContain('fetch("/api/erp/material-categories")');
    expect(page).toContain('params.set("categoryId", categoryId)');
    expect(page).toContain("全部物料分类");
    expect(page).toContain("flattenCategories(categories)");
  });

  it("continues to use the pre-existing service category filter", () => {
    const service = read("src/modules/erp/inventory/service.ts");
    expect(service).toContain('searchParams.get("categoryId")');
    expect(service).toContain("where.material = { categoryId }");
  });
});
