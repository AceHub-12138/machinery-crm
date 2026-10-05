import { describe, expect, it } from "vitest";
import { deliveryRisk, deliveryStatusFor } from "./supplier-delivery";
const now = new Date("2026-07-15T00:00:00Z");
describe("supplier delivery", () => {
  it("keeps a partially received line open", () => expect(deliveryStatusFor({ quantity: 100, receivedQuantity: 30, latestPromisedDate: new Date("2026-07-20") }, now)).toBe("PARTIAL_RECEIVED"));
  it("marks an overdue balance", () => expect(deliveryStatusFor({ quantity: 100, receivedQuantity: 30, latestPromisedDate: new Date("2026-07-14") }, now)).toBe("OVERDUE_PARTIAL_RECEIVED"));
  it("uses the latest promise and detects production impact", () => expect(deliveryRisk({ latestPromisedDate: new Date("2026-08-01"), needArrivalDate: new Date("2026-07-25"), actualShipDate: null, receivedQuantity: 0, quantity: 100, lastFollowedAt: now, hasDelayRisk: false, attentionDays: 7, highRiskDays: 3 }, now)).toMatchObject({ level: "HIGH_RISK", affectsProduction: true }));
});
