import { describe, expect, it } from "vitest";
import { calculateSuggestedProcurement, reconcileDemandSuggestion } from "./procurement-planning";

describe("calculateSuggestedProcurement", () => {
  it("keeps safety stock after satisfying a production demand", () => {
    const result = calculateSuggestedProcurement({ newDemand: 10, safetyStockTarget: 5, inventory: 10, confirmedInbound: 0, reservedNotIssued: 0, existingEffectiveDemand: 0 });
    expect(result.suggestedQuantity.toNumber()).toBe(5);
  });
  it("subtracts confirmed inbound and active purchase demand once", () => {
    const result = calculateSuggestedProcurement({ newDemand: 20, safetyStockTarget: 5, inventory: 2, confirmedInbound: 8, reservedNotIssued: 3, existingEffectiveDemand: 4 });
    expect(result.expectedAvailable.toNumber()).toBe(7);
    expect(result.suggestedQuantity.toNumber()).toBe(14);
  });
  it("never returns a negative suggestion", () => {
    expect(calculateSuggestedProcurement({ newDemand: 1, safetyStockTarget: 2, inventory: 10, confirmedInbound: 5, reservedNotIssued: 0, existingEffectiveDemand: 0 }).suggestedQuantity.toNumber()).toBe(0);
  });
});

describe("reconcileDemandSuggestion", () => {
  it("preserves already converted quantity when recalculation returns only the remaining shortage", () => {
    expect(reconcileDemandSuggestion(6, 6)).toMatchObject({ shouldClose: false });
    expect(reconcileDemandSuggestion(6, 6).suggestedQuantity.toNumber()).toBe(12);
  });

  it("closes a partially converted demand when stock and inbound cover the remaining shortage", () => {
    const result = reconcileDemandSuggestion(0, 6);
    expect(result.shouldClose).toBe(true);
    expect(result.suggestedQuantity.toNumber()).toBe(6);
  });
});
