import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const inventoryService = readFileSync(resolve(process.cwd(), "src/modules/erp/inventory/service.ts"), "utf8");
const materialsRoute = readFileSync(resolve(process.cwd(), "src/app/api/erp/materials/route.ts"), "utf8");
const materialDetailRoute = readFileSync(resolve(process.cwd(), "src/app/api/erp/materials/[id]/route.ts"), "utf8");
const materialsPage = readFileSync(resolve(process.cwd(), "src/app/(app)/erp/materials/page.tsx"), "utf8");

describe("库存台账与物料主数据：软删除物料防护契约", () => {
  it("台账过滤已删除物料的零库存行，但保留其真实库存行", () => {
    expect(inventoryService).toContain(
      "where.OR = [{ material: { deletedAt: null } }, { quantity: { not: 0 } }];",
    );
  });

  it("物料新增/编辑接口把编码唯一冲突翻译为 409 人话提示", () => {
    for (const route of [materialsRoute, materialDetailRoute]) {
      expect(route).toContain('error.code === "P2002"');
      expect(route).toContain("duplicateCodeResponse");
      expect(route).toContain("status: 409");
      expect(route).toContain("该物料已删除");
    }
  });

  it("冲突提示标注占用方名称与删除状态", () => {
    for (const route of [materialsRoute, materialDetailRoute]) {
      expect(route).toContain("select: { name: true, deletedAt: true }");
      expect(route).toContain("已被「");
    }
  });

  it("网页端物料弹窗保存失败时保留弹窗并显示原因", () => {
    expect(materialsPage).toContain("if (!res.ok)");
    expect(materialsPage).toContain("setFormError(data?.error || `保存失败（${res.status}）`)");
    expect(materialsPage).toContain("{formError && <p className=\"text-sm text-red-600");
  });
});
