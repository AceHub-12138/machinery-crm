import { describe, expect, it } from "vitest";
import { isInventoryBelowWarningThreshold, resolveInventoryWarningThreshold } from "./inventory-alert";

describe("resolveInventoryWarningThreshold", () => {
  it("treats safetyStock=0 as not set and falls back to the category threshold", () => {
    expect(resolveInventoryWarningThreshold({ safetyStock: 0, category: { warningThreshold: 10 } })).toBe(10);
    expect(resolveInventoryWarningThreshold({ safetyStock: 0, category: { warningThreshold: null } })).toBeNull();
    expect(isInventoryBelowWarningThreshold(0, { safetyStock: 0, category: { warningThreshold: null } })).toBe(false);
  });

  it("falls back to the category threshold only when safetyStock is null", () => {
    expect(resolveInventoryWarningThreshold({ safetyStock: null, category: { warningThreshold: 10 } })).toBe(10);
  });

  it("uses a positive material safety stock before the category threshold", () => {
    expect(resolveInventoryWarningThreshold({ safetyStock: 5, category: { warningThreshold: 10 } })).toBe(5);
    expect(isInventoryBelowWarningThreshold(5, { safetyStock: 5, category: { warningThreshold: 10 } })).toBe(true);
  });

  it("does not alert when neither level provides a usable threshold", () => {
    expect(resolveInventoryWarningThreshold({ safetyStock: null, category: { warningThreshold: null } })).toBeNull();
  });

  it("ignores the material safety stock when safetyStockEnabled is false", () => {
    expect(resolveInventoryWarningThreshold({ safetyStock: 5, safetyStockEnabled: false, category: { warningThreshold: 10 } })).toBe(10);
    expect(resolveInventoryWarningThreshold({ safetyStock: 5, safetyStockEnabled: false, category: { warningThreshold: null } })).toBeNull();
  });

  it("honors the material safety stock when safetyStockEnabled is true", () => {
    expect(resolveInventoryWarningThreshold({ safetyStock: 5, safetyStockEnabled: true, category: { warningThreshold: 10 } })).toBe(5);
  });

  it("keeps the legacy behavior when safetyStockEnabled is missing", () => {
    expect(resolveInventoryWarningThreshold({ safetyStock: 5, category: { warningThreshold: 10 } })).toBe(5);
    expect(isInventoryBelowWarningThreshold(4, { safetyStock: 5, category: { warningThreshold: 10 } })).toBe(true);
  });
});
