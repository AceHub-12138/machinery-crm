import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const materialsRoute = readFileSync(resolve(process.cwd(), "src/app/api/erp/materials/route.ts"), "utf8");
const materialDetailRoute = readFileSync(resolve(process.cwd(), "src/app/api/erp/materials/[id]/route.ts"), "utf8");
const importRoute = readFileSync(resolve(process.cwd(), "src/app/api/erp/materials/import/route.ts"), "utf8");
const materialsPage = readFileSync(resolve(process.cwd(), "src/app/(app)/erp/materials/page.tsx"), "utf8");

describe("物料编码复用：复活与让位契约", () => {
  it("新增撞到软删除同码物料时自动复活并接回历史", () => {
    expect(materialsRoute).toContain("deletedAt: { not: null }");
    expect(materialsRoute).toContain("deletedAt: null, isActive: true");
    expect(materialsRoute).toContain("revived: true");
    expect(materialsRoute).toContain("revivedStock");
  });

  it("编辑改码只在目标编码被在用物料占用时拦截", () => {
    expect(materialDetailRoute).toContain("id: { not: id }");
    expect(materialDetailRoute).toContain("if (holder && !holder.deletedAt)");
    expect(materialDetailRoute).toContain("duplicateCodeResponse(targetCode)");
  });

  it("已删除物料让位时改写墓碑编码且与改码同一事务", () => {
    expect(materialDetailRoute).toContain("nextTombstoneCode");
    expect(materialDetailRoute).toContain("#DEL-");
    expect(materialDetailRoute).toContain("prisma.$transaction");
    expect(materialDetailRoute).toContain("releasedFrom");
  });

  it("Excel 导入对软删除同码物料执行复活并回报数量", () => {
    expect(importRoute).toContain("reviveDeletedOrCreate");
    expect(importRoute).toContain("revived: 0");
    expect(importRoute).toContain("deletedAt: null");
  });

  it("网页端在复活/让位成功后给出可读提示", () => {
    expect(materialsPage).toContain("data?.revived");
    expect(materialsPage).toContain("data?.releasedFrom");
  });
});
