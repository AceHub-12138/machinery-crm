import { describe, expect, it } from "vitest";
import { monthlyDemandAllocation, parsePlanMonth } from "./monthly-production-plans";

describe("monthlyDemandAllocation", () => {
  it("splits the planned shortage proportionally across partial work-order conversions", () => {
    expect(monthlyDemandAllocation(20, 3, 10).toNumber()).toBe(6);
    expect(monthlyDemandAllocation(20, 7, 10).toNumber()).toBe(14);
  });

  it("never allocates the gross material demand when only a smaller shortage was suggested", () => {
    expect(monthlyDemandAllocation(20, 3, 10).toNumber()).toBeLessThan(30);
  });
});

describe("parsePlanMonth", () => {
  it("normalizes a month input to the first day of that month", () => {
    expect(parsePlanMonth("2026-07").toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("rejects invalid month values instead of rolling them into another year", () => {
    expect(() => parsePlanMonth("2026-13")).toThrow("计划月份格式无效");
    expect(() => parsePlanMonth("2026-7")).toThrow("计划月份格式无效");
  });
});
