import { describe, expect, it } from "vitest";
import {
  assertPlannedCompletionDate,
  calculateKitMaterialQuantities,
  calculateRemainingContractQuantity,
  isProductionOrderConcurrencyConflict,
  issuedOrderNo,
  normalizeProductionRequestKey,
  normalizeManualDocumentNo,
  resolveDeliveryDateSnapshot,
  shortageDemandItems,
} from "./production-orders";

describe("production order numbering", () => {
  it("trims a manual document number and rejects an empty value", () => {
    expect(normalizeManualDocumentNo("  MO-001  ", "工单编号")).toBe("MO-001");
    expect(() => normalizeManualDocumentNo("  ", "工单编号")).toThrow("工单编号为必填项");
  });
  it("uses contract number with a two-digit increasing sequence", () => {
    expect(issuedOrderNo("HT20260713", 1, "MO20260713-001")).toBe("HT20260713-01");
    expect(issuedOrderNo("HT20260713", 2, "MO20260713-001")).toBe("HT20260713-02");
  });

  it("keeps stock order numbers in MOYYYYMMDD-001 form", () => {
    expect(issuedOrderNo(null, null, "MO20260713-001")).toBe("MO20260713-001");
  });
});

describe("contract item production limits", () => {
  it("recognizes MySQL 5.7 deadlocks wrapped by Prisma raw queries", () => {
    expect(isProductionOrderConcurrencyConflict({ code: "P2010", meta: { code: "1213" } })).toBe(true);
    expect(isProductionOrderConcurrencyConflict({ code: "P2010", meta: { code: "1062" } })).toBe(false);
    expect(isProductionOrderConcurrencyConflict(new Error("unrelated"))).toBe(false);
  });

  it("requires a stable server idempotency key for draft creation", () => {
    expect(normalizeProductionRequestKey("550e8400-e29b-41d4-a716-446655440000")).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(() => normalizeProductionRequestKey("short")).toThrow("幂等标识");
  });

  it("subtracts every active generated order and never returns a negative remainder", () => {
    expect(calculateRemainingContractQuantity(5, [2, 1]).toString()).toBe("2");
    expect(calculateRemainingContractQuantity(5, [3, 3]).toString()).toBe("0");
  });

  it("rejects a planned completion date after the contract delivery date", () => {
    expect(() => assertPlannedCompletionDate(new Date("2026-07-20"), new Date("2026-07-20"))).not.toThrow();
    expect(() => assertPlannedCompletionDate(new Date("2026-07-21"), new Date("2026-07-20"))).toThrow("合同交货日期");
  });

  it("freezes item delivery first, then header, while stock orders use planned completion", () => {
    const item = new Date("2026-07-20"); const header = new Date("2026-07-25"); const planned = new Date("2026-07-18");
    expect(resolveDeliveryDateSnapshot({ contractItemDeliveryDate: item, contractHeaderDeliveryDate: header, plannedDate: planned })).toBe(item);
    expect(resolveDeliveryDateSnapshot({ contractItemDeliveryDate: null, contractHeaderDeliveryDate: header, plannedDate: planned })).toBe(header);
    expect(resolveDeliveryDateSnapshot({ plannedDate: planned })).toBe(planned);
  });
});

describe("kit check after production material movements", () => {
  it("creates demand candidates only for materials with a positive shortage", () => {
    expect(shortageDemandItems([
      { materialId: "m1", remainingRequiredQty: 10, shortageQty: 3 },
      { materialId: "m2", remainingRequiredQty: 5, shortageQty: 0 },
    ])).toEqual([{ materialId: "m1", newDemand: 10 }]);
  });

  it("does not repurchase material already net-issued to the order", () => {
    const result = calculateKitMaterialQuantities(10, 6, 1, 2);
    expect(result.netIssuedQty.toNumber()).toBe(5);
    expect(result.remainingQty.toNumber()).toBe(5);
    expect(result.shortageQty.toNumber()).toBe(3);
  });

  it("never returns a negative remaining demand or shortage", () => {
    const result = calculateKitMaterialQuantities(10, 12, 0, 0);
    expect(result.remainingQty.toNumber()).toBe(0);
    expect(result.shortageQty.toNumber()).toBe(0);
  });
});
