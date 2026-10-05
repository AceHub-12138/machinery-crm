import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("作废入库不计入生产退料汇总", () => {
  it("覆盖所有生产退料汇总点，而不是只覆盖计划书列出的起始文件", () => {
    expect(read("src/app/api/erp/stock-in/route.ts")).toContain('tx.stockIn.findMany({ where: { productionOrderId, status: "CONFIRMED" }');
    expect(read("src/app/api/erp/stock-out/route.ts")).toContain('tx.stockIn.findMany({ where: { productionOrderId, status: "CONFIRMED" }');
    expect(read("src/lib/production-orders.ts")).toContain('tx.stockIn.findMany({ where: { productionOrderId: order.id, status: "CONFIRMED" }');
    expect(read("src/lib/production-orders.ts")).toContain('prisma.stockIn.findMany({ where: { productionOrderId: order.id, status: "CONFIRMED" }');
    expect(read("src/app/api/erp/production-orders/[id]/status/route.ts")).toContain('tx.stockIn.findMany({ where: { productionOrderId: id, status: "CONFIRMED" }');
    expect(read("src/app/api/erp/production-order-change-requests/[id]/approve/route.ts")).toContain('tx.stockIn.findMany({ where: { productionOrderId: current.id, status: "CONFIRMED" }');
    expect(read("src/lib/procurement-planning.ts")).toContain('stockIn: { productionOrderId: { in: orderIds }, status: "CONFIRMED" }');
  });
});
