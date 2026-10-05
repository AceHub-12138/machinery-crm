import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTO_DOCUMENT_RULES,
  assertAutoDocumentRules,
  formatAutoDocumentNo,
  formatAfterSalesOrderNo,
  formatStockInAutoNumber,
  formatStockOutAutoNumber,
  nextDailySequenceFromCount,
  resolveStockInBatchNo,
  resolveStockOutBatchNo,
} from "./document-number";

describe("automatic document numbering", () => {
  it("uses the count of same-day prefixed documents instead of parsing historical random suffixes", () => {
    expect(nextDailySequenceFromCount(2)).toBe(3);
    expect(formatAutoDocumentNo(DEFAULT_AUTO_DOCUMENT_RULES.PURCHASE_ORDER, 2, new Date("2026-08-03T08:00:00.000Z"))).toBe("PO20260803" + "003");
  });
});

describe("stock-in automatic numbering", () => {
  it("uses the Shanghai calendar date and starts each day at 01", () => {
    expect(formatStockInAutoNumber([], new Date("2026-08-11T16:30:00.000Z"))).toBe("2026081201");
  });

  it("continues after the largest existing numeric suffix without considering other formats", () => {
    expect(formatStockInAutoNumber(["2026081101", "2026081109", "RK20260811A", "2026081201"], new Date("2026-08-11T08:00:00.000Z"))).toBe("2026081110");
  });

  it("keeps a manually entered number unchanged", () => {
    expect(resolveStockInBatchNo("MANUAL-001", ["2026081101"], new Date("2026-08-11T08:00:00.000Z"))).toBe("MANUAL-001");
  });
});

describe("stock-out automatic numbering", () => {
  it("does not allow the configured prefix to be emptied", () => {
    expect(() => assertAutoDocumentRules({ STOCK_OUT: { prefix: "", dateFormat: "yyyyMMdd", sequenceLength: 3, separator: "", resetCycle: "DAY" } })).toThrow("出库单自动编号前缀不能为空");
  });

  it("increments multiple documents on the same Shanghai date", () => {
    const date = new Date("2026-08-11T08:00:00.000Z");
    const rule = DEFAULT_AUTO_DOCUMENT_RULES.STOCK_OUT;

    expect(formatStockOutAutoNumber(rule, [], date)).toBe("CH20260811001");
    expect(formatStockOutAutoNumber(rule, ["CH20260811001"], date)).toBe("CH20260811002");
  });

  it("uses the largest same-day sequence after an intermediate document is deleted", () => {
    const rule = DEFAULT_AUTO_DOCUMENT_RULES.STOCK_OUT;

    expect(formatStockOutAutoNumber(rule, ["CH20260811001", "CH20260811003"], new Date("2026-08-11T08:00:00.000Z"))).toBe("CH20260811004");
  });

  it("keeps a manually entered number unchanged", () => {
    expect(resolveStockOutBatchNo("MANUAL-001", DEFAULT_AUTO_DOCUMENT_RULES.STOCK_OUT, ["CH20260811001"], new Date("2026-08-11T08:00:00.000Z"))).toBe("MANUAL-001");
  });

  it("resets to 001 on the next Shanghai calendar day", () => {
    expect(formatStockOutAutoNumber(DEFAULT_AUTO_DOCUMENT_RULES.STOCK_OUT, ["CH20260811009"], new Date("2026-08-11T16:30:00.000Z"))).toBe("CH20260812001");
  });
});

describe("after-sales automatic numbering", () => {
  it("uses the largest same-day sequence and resets on the Shanghai calendar day", () => {
    const rule = DEFAULT_AUTO_DOCUMENT_RULES.AFTER_SALES_ORDER;
    expect(rule.prefix).toBe("SH");
    expect(formatAfterSalesOrderNo(rule, ["SH-20260901-001", "SH-20260901-003"], new Date("2026-09-01T08:00:00.000Z"))).toBe("SH-20260901-004");
    expect(formatAfterSalesOrderNo(rule, ["SH-20260901-003"], new Date("2026-09-01T16:30:00.000Z"))).toBe("SH-20260902-001");
  });
});
