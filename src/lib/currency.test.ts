import { isDeepStrictEqual } from "node:util";
import { it, expect } from "vitest";
import { formatMoney, formatPriceSnapshot, sumByCurrency, currencyLines, dashboardAmounts, contractPaymentLabel } from "./currency";
const records = [
  { currency: "CNY", amount: "50000.00", paidAmount: "20000.00" },
  { currency: "CNY", amount: "60000.00", paidAmount: "30000.00" },
  { currency: "CNY", amount: "75500.00", paidAmount: "25000.00" },
  { currency: "EUR", amount: "25600.00", paidAmount: "5600.00" },
];
it("three CNY contracts and one EUR contract never mix", () => {
  equal(sumByCurrency(records), [{ currency: "CNY", amount: "185500.00" }, { currency: "EUR", amount: "25600.00" }]);
  equal(sumByCurrency(records, "paidAmount"), [{ currency: "CNY", amount: "75000.00" }, { currency: "EUR", amount: "5600.00" }]);
});
it("formatting follows CNY EUR and other currency codes", () => {
  equal(formatMoney(185500, "CNY"), "¥185,500");
  equal(formatMoney(25600, "EUR"), "€25,600");
  equal(formatMoney(25000.5, "USD"), "USD 25,000.5");
  equal(formatMoney(null, "EUR"), "-");
  equal(formatMoney("NaN", "EUR"), "-");
  equal(formatMoney(-2.55, "EUR"), "€-2.55");
});
it("legacy missing fields fall back to CNY; empty new groups do not read legacy mixed totals", () => {
  equal(dashboardAmounts(undefined, "periodContractAmount", "185500"), [{ currency: "CNY", amount: 185500 }]);
  equal(dashboardAmounts({}, "totalPaidAmount", "75000"), [{ currency: "CNY", amount: 75000 }]);
  equal(dashboardAmounts({ periodContractAmount: [] }, "periodContractAmount", 211100), []);
  equal(currencyLines([]).primary, "¥0");
});
it("CNY alone and zero foreign amounts never create a foreign line", () => {
  equal(currencyLines([{ currency: "CNY", amount: 185500 }]).foreign, []);
  equal(currencyLines([{ currency: "CNY", amount: 185500 }, { currency: "EUR", amount: 0 }]).foreign, []);
  equal(currencyLines(sumByCurrency(records)).foreign, ["+ €25,600"]);
});
it("two foreign currencies get two lines; three collapse with full hover text", () => {
  const two = [{ currency: "EUR", amount: 25600 }, { currency: "USD", amount: 1234 }];
  equal(currencyLines(two).primary, "¥0");
  equal(currencyLines(two).foreign, ["+ €25,600", "+ USD 1,234"]);
  const lines = currencyLines([...two, { currency: "GBP", amount: 99 }]);
  equal(lines.foreign, ["+ €25,600 等 3 种"]);
  equal(lines.title, "¥0\n+ €25,600\n+ GBP 99\n+ USD 1,234");
});
it("cent aggregation keeps exact fractions", () => {
  equal(sumByCurrency([{ amount: "0.10" }, { amount: "0.20" }]), [{ currency: "CNY", amount: "0.30" }]);
});
it("foreign payments cannot cancel CNY arrears", () => {
  equal(contractPaymentLabel([{ currency: "CNY", amount: 100, paidAmount: 50 }, { currency: "EUR", amount: 10, paidAmount: 1000 }]), "部分回款");
  equal(contractPaymentLabel([{ currency: "CNY", amount: 100, paidAmount: 100 }, { currency: "EUR", amount: 10, paidAmount: 10 }]), "已回款");
  equal(contractPaymentLabel([]), "-");
});
it("historical snapshots do not guess a currency", () => {
  equal(formatPriceSnapshot("100000"), "100,000（币种待确认）");
  equal(formatPriceSnapshot(null), "-");
});

function equal(actual: unknown, expected: unknown) { expect(isDeepStrictEqual(actual, expected), JSON.stringify({ actual, expected })).toBe(true); }
