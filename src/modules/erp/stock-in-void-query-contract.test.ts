import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const listRoute = readFileSync(resolve(process.cwd(), "src/app/api/erp/stock-in/route.ts"), "utf8");
const detailRoute = readFileSync(resolve(process.cwd(), "src/app/api/erp/stock-in/[id]/route.ts"), "utf8");

describe("StockIn 作废查询与流水展示契约", () => {
  it("使用真实 status 筛选并在创建时继续显式确认", () => {
    expect(listRoute).toContain('status === "CONFIRMED" || status === "VOIDED"');
    expect(listRoute).toContain('where.status = status');
    expect(listRoute).toContain('status: "CONFIRMED"');
    expect(listRoute).toContain("voidRecord: { select: { id: true, createdAt: true } }");
    expect(listRoute).toContain("select: { id: true, name: true }");
  });

  it("详情保留作废审计、原入库和反向冲减流水及操作日志", () => {
    expect(detailRoute).toContain("voidRecord:");
    expect(detailRoute).toContain('refType: "StockInVoid"');
    expect(detailRoute).toContain("prisma.operationLog.findMany");
    expect(detailRoute).toContain("stockMovements");
    expect(detailRoute).toContain("operationLogs");
    expect(detailRoute).toContain("select: { id: true, name: true }");
    expect(detailRoute).toContain("select: { id: true, action: true, createdAt: true }");
  });
});
