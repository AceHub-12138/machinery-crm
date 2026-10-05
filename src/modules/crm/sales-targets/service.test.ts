import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/sales-items", () => ({ writeOperationLog: vi.fn() }));
vi.mock("@/lib/permissions", () => ({
  canSeeAllData: (user: { role: string }) => user.role === "SUPER_ADMIN",
  customerIsolationWhere: () => ({}),
  matchesTerritory: () => false,
}));

import {
  calculateSalesTargetProgress,
  parseSalesTargetInput,
  parseSalesTargetPeriod,
  parseTargetAmount,
} from "./service";

describe("sales target period", () => {
  it("builds the dashboard-compatible half-open range for a month", () => {
    expect(
      parseSalesTargetPeriod(
        new URLSearchParams({ periodType: "MONTH", year: "2026", month: "8" }),
        new Date(2026, 7, 10),
      ),
    ).toEqual({
      periodType: "MONTH",
      periodYear: 2026,
      periodIndex: 8,
      start: new Date(2026, 7, 1),
      end: new Date(2026, 8, 1),
      label: "2026年8月",
    });
  });
});

describe("sales target progress", () => {
  it.each([
    ["0", "100", 0, 0, "100.00", false],
    ["50", "100", 50, 50, "50.00", false],
    ["100", "100", 100, 100, "0.00", false],
    ["126.50", "100", 126.5, 100, "0.00", true],
  ])(
    "calculates actual %s against target %s without clipping the text rate",
    (actual, target, completionRate, visualRate, remainingAmount, exceeded) => {
      expect(calculateSalesTargetProgress(actual, target)).toMatchObject({
        completionRate,
        visualRate,
        remainingAmount,
        exceeded,
      });
    },
  );
});

describe("sales target amount", () => {
  it("keeps a valid amount as an exact two-decimal Decimal", () => {
    expect(parseTargetAmount("123456.70").toFixed(2)).toBe("123456.70");
  });

  it.each(["0", "-1", "NaN", "Infinity", "1.001", "", "1000000000000.00"])(
    "rejects an invalid monetary value: %s",
    (amount) => {
      expect(() => parseTargetAmount(amount)).toThrow();
    },
  );
});

describe("sales target write input", () => {
  it("normalizes a yearly target to periodIndex 0 and exact money", () => {
    expect(parseSalesTargetInput({
      periodType: "YEAR",
      periodYear: 2026,
      metric: "PAID_AMOUNT",
      amount: "1200000.5",
    })).toEqual({
      periodType: "YEAR",
      periodYear: 2026,
      periodIndex: 0,
      metric: "PAID_AMOUNT",
      amount: "1200000.50",
      salesUserId: null,
      note: null,
    });
  });

  it.each([
    [{ periodType: "MONTH", periodYear: 2019, periodIndex: 1, metric: "CONTRACT_AMOUNT", amount: "1" }],
    [{ periodType: "MONTH", periodYear: 2026, periodIndex: 13, metric: "CONTRACT_AMOUNT", amount: "1" }],
    [{ periodType: "YEAR", periodYear: 2026, periodIndex: 1, metric: "CONTRACT_AMOUNT", amount: "1" }],
  ])("rejects an illegal year or period index", (input) => {
    expect(() => parseSalesTargetInput(input)).toThrow();
  });
});
