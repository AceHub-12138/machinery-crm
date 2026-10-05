import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("ERP acceptance UI guards", () => {
  it("keeps the shared material selector shrinkable inside responsive layouts", () => {
    const combobox = source("src/components/erp/material-combobox.tsx");
    const purchaseDemands = source("src/app/(app)/erp/purchase-demands/page.tsx");
    const stockTransfers = source("src/app/(app)/erp/stock-transfers/page.tsx");
    const stockIn = source("src/app/(app)/erp/stock-in/page.tsx");
    const stockOut = source("src/app/(app)/erp/stock-out/page.tsx");
    const spareForecast = source("src/app/(app)/erp/monthly-production-plans/spare-parts-forecast/page.tsx");
    expect(combobox).toContain('className="relative min-w-0 w-full flex-1"');
    expect(combobox).not.toContain("sm:min-w-[340px]");
    expect(purchaseDemands).not.toContain("md:grid-cols-5");
    expect(stockTransfers).not.toContain("md:grid-cols-5");
    expect(stockIn).toContain("lg:flex-row lg:items-center");
    expect(stockOut).toContain("lg:flex-row lg:items-center");
    expect(spareForecast).toContain("xl:grid-cols-[minmax(0,1fr)_140px_170px_40px]");
  });

  it("uses a month picker and names both monthly plan dates", () => {
    const page = source("src/app/(app)/erp/monthly-production-plans/page.tsx");
    expect(page).toContain('type="month"');
    expect(page).toContain("计划开始日期");
    expect(page).toContain("计划完成日期");
  });

  it("keeps the stage-1 business-scenario navigation", () => {
    const sidebar = source("src/components/layout/sidebar.tsx");
    const labels = [
      "工作台", "客户与销售", "采购与供应", "库存与物料", "生产执行", "平台管理",
    ];
    let previous = -1;
    for (const label of labels) {
      const index = sidebar.indexOf(`label: "${label}"`, previous + 1);
      expect(index, `${label} should appear after the previous ERP item`).toBeGreaterThan(previous);
      previous = index;
    }
  });

  it("keeps warehouse write controls aligned with the approved ERP role matrix", () => {
    const middleware = source("src/middleware.ts");
    const materials = source("src/app/(app)/erp/materials/page.tsx");
    const bom = source("src/app/(app)/erp/bom/page.tsx");
    expect(middleware).toContain('"/erp/stock-transfers"');
    expect(materials).toContain('userRole === "SUPER_ADMIN" || userRole === "WAREHOUSE"');
    expect(bom).toContain('userRole === "SUPER_ADMIN" || userRole === "WAREHOUSE"');
  });

  it("keeps the requested stock document filters and workbench labels", () => {
    const stockIn = source("src/app/(app)/erp/stock-in/page.tsx");
    const stockOut = source("src/app/(app)/erp/stock-out/page.tsx");
    const stockInApi = source("src/app/api/erp/stock-in/route.ts");
    const stockOutApi = source("src/app/api/erp/stock-out/route.ts");
    const sidebar = source("src/components/layout/sidebar.tsx");
    expect(stockIn).toContain("筛选入库记录");
    expect(stockOut).toContain("筛选出库记录");
    expect(stockIn).toContain("物料名称、编码或入库单号");
    expect(stockOut).toContain("物料名称、编码或出库单号");
    expect(stockInApi).toContain('searchParams.get("dateFrom")');
    expect(stockOutApi).toContain('searchParams.get("dateTo")');
    expect(sidebar).toContain('label: "CRM工作台"');
    expect(sidebar).toContain('label: "ERP工作台"');
    expect(sidebar).toContain('label: "管理员工作台"');
  });

  it("explains BOM hierarchy and lets each selected child start with its own quantity", () => {
    const bom = source("src/app/(app)/erp/bom/page.tsx");
    expect(bom).toContain("加入数量");
    expect(bom).toContain("零件包规格中的文字说明不会自动拆成子物料");
    expect(bom).toContain("整机物料");
    expect(bom).toContain("子物料");
    expect(bom).toContain("orderedDetailItems.map");
  });

  it("requires all three supplier identity fields on the page and API", () => {
    const page = source("src/app/(app)/erp/suppliers/page.tsx");
    const createRoute = source("src/app/api/erp/suppliers/route.ts");
    const updateRoute = source("src/app/api/erp/suppliers/[id]/route.ts");
    expect(page).toContain('联系人${editId ? "" : " *"}');
    expect(page).toContain('联系电话${editId ? "" : " *"}');
    expect(createRoute).toContain("validateNewSupplierInput(body)");
    expect(updateRoute).toContain("normalizeSupplierInput(body)");
  });
});
