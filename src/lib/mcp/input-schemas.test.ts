import { describe, expect, it } from "vitest";
import {
  optionalDateFilter,
  optionalLocationFilter,
  optionalSearchFilter,
  optionalStockReferenceTypeFilter,
  optionalUuidReferenceFilter,
  requiredUuidReferenceFilter,
} from "@/lib/mcp/input-schemas";

const validUuid = "123e4567-e89b-42d3-a456-426614174000";

describe("MCP input filter schemas", () => {
  it("normalizes supported optional date spellings to YYYY-MM-DD", () => {
    const schema = optionalDateFilter("开始日期");

    for (const value of [undefined, null, "", "   ", "null", "UNDEFINED"]) {
      expect(schema.parse(value), String(value)).toBeUndefined();
    }
    expect(schema.parse(" 2026-01-01 ")).toBe("2026-01-01");
    expect(schema.parse("2026-1-1")).toBe("2026-01-01");
    expect(schema.parse("2026/1/1")).toBe("2026-01-01");
    expect(schema.parse("2026-1-1T08:30:00+08:00")).toBe("2026-01-01");
    expect(schema.parse("2026/1/1 08:30:00")).toBe("2026-01-01");
  });

  it("leaves unsupported or semantically invalid date values for date validation to reject", () => {
    const schema = optionalDateFilter("开始日期");

    for (const value of [
      "2026-2-30",
      "2026-02-30",
      "2026-13-01",
      "2026-1-1T08:30garbage",
      "2026-01-01T99:99:99",
      "2026-01-01T08:30:00+99:99",
      "01-01-2026",
      "tomorrow",
      20260101,
    ]) {
      expect(schema.safeParse(value).success, String(value)).toBe(false);
    }
  });

  it("reserves a required UUID reference filter for later required-id hardening", () => {
    const schema = requiredUuidReferenceFilter("记录 UUID");

    expect(schema.parse(`  ${validUuid}  `)).toBe(validUuid);
    expect(schema.safeParse(undefined).success).toBe(false);
    expect(schema.safeParse("record-1").success).toBe(false);
  });

  it("accepts only omitted or valid optional UUID references", () => {
    const schema = optionalUuidReferenceFilter("可选记录 UUID");

    for (const value of [undefined, null, "", "   ", "null", "UNDEFINED"]) {
      expect(schema.parse(value), String(value)).toBeUndefined();
    }
    expect(schema.parse(`  ${validUuid}  `)).toBe(validUuid);
    for (const value of [1, 12, "1", "12", "invalid-uuid", "N/A", "None", "NaN"]) {
      expect(schema.safeParse(value).success, String(value)).toBe(false);
    }
  });

  it("drops only structural location placeholders and keeps ordinary text", () => {
    const schema = optionalLocationFilter("省市筛选");

    for (const value of [undefined, null, "", "   ", "null", "UNDEFINED", "1", "12"]) {
      expect(schema.parse(value), String(value)).toBeUndefined();
    }
    for (const value of ["山东省", "济南市", "全部", "无", "N/A", "None", "NaN"]) {
      expect(schema.parse(`  ${value}  `), value).toBe(value);
    }
    expect(schema.safeParse(1).success).toBe(false);
  });

  it("drops only nullish search placeholders and preserves numeric or semantic text", () => {
    const schema = optionalSearchFilter("关键词");

    for (const value of [undefined, null, "", "   ", "null", "UNDEFINED"]) {
      expect(schema.parse(value), String(value)).toBeUndefined();
    }
    for (const value of ["1", "12", "全部", "无", "N/A", "None", "NaN"]) {
      expect(schema.parse(`  ${value}  `), value).toBe(value);
    }
  });

  it("accepts only repository-backed stock reference types", () => {
    const schema = optionalStockReferenceTypeFilter("来源类型");

    for (const value of [undefined, null, "", "   ", "null", "UNDEFINED"]) {
      expect(schema.parse(value), String(value)).toBeUndefined();
    }
    for (const value of ["StockIn", "StockOut", "StockCheck", "StockTransfer"]) {
      expect(schema.parse(value), value).toBe(value);
    }
    expect(schema.parse(" StockIn ")).toBe("StockIn");
    for (const value of [1, "1", "Unknown", "stockin"]) {
      expect(schema.safeParse(value).success, String(value)).toBe(false);
    }
  });
});
