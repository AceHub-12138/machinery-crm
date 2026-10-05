import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(resolve(process.cwd(), "src/app/(app)/erp/stock-in/page.tsx"), "utf8");

describe("StockIn 作废页面与打印口径", () => {
  it("将旧说明弹窗替换为真实原因确认和作废 API 调用", () => {
    expect(page).toContain("/api/erp/stock-in/${correctionTarget.id}/void");
    expect(page).toContain("作废原因（5–500 字）");
    expect(page).toContain("确认作废");
    expect(page).not.toContain("当前数据表暂未提供 status、voidedAt、voidReason 等作废字段。");
  });

  it("显示真实状态和作废审计，并保留原生筛选打印", () => {
    expect(page).toContain('<option value="VOIDED">已作废</option>');
    expect(page).toContain('si.status === "VOIDED" ? "已作废" : "已确认"');
    expect(page).toContain("作废反向冲减明细");
    expect(page).toContain("库存流水");
    expect(page).toContain("操作日志");
    expect(page).not.toContain("反向审计号：");
    expect(page).toContain("print-void-reason");
    expect(page).toContain("collectPrintResults");
    expect(page).toContain("window.print()");
    expect(page).toContain("@media print");
  });
});
