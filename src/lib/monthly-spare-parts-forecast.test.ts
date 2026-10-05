import { describe, expect, it } from "vitest";
import { normalizeMonthlySparePartsForecast } from "./monthly-spare-parts-forecast";

describe("normalizeMonthlySparePartsForecast", () => {
  it("normalizes one monthly spare-parts forecast batch", () => {
    const result = normalizeMonthlySparePartsForecast({
      forecastMonth: "2026-07",
      remark: "售后常用备件",
      items: [
        { materialId: "material-1", quantity: "3", needByDate: "2026-07-20" },
      ],
    });

    expect(result.forecastMonth).toBe("2026-07");
    expect(result.sourceLabel).toBe("2026-07 月度生产计划备件预测");
    expect(result.items[0].quantity.toString()).toBe("3");
    expect(result.items[0].needByDate.toISOString().slice(0, 10)).toBe("2026-07-20");
  });

  it("rejects duplicate materials in the same forecast batch", () => {
    expect(() => normalizeMonthlySparePartsForecast({
      forecastMonth: "2026-07",
      items: [
        { materialId: "material-1", quantity: "1", needByDate: "2026-07-20" },
        { materialId: "material-1", quantity: "2", needByDate: "2026-07-25" },
      ],
    })).toThrow("不能重复");
  });
});
