import { it, expect } from "vitest";
import { compactMoney, currencyDisplayRows } from "./currency";
it("compact values preserve the currency and use Chinese amount units", () => {
  equal(compactMoney(110500), "¥11.05 万");
  equal(compactMoney(185500), "¥18.55 万");
  equal(compactMoney(25600, "EUR"), "€2.56 万");
  equal(compactMoney(120000000), "¥1.2 亿");
  equal(compactMoney(100000000, "USD"), "USD 1 亿");
  equal(compactMoney(-120000000, "EUR"), "€-1.2 亿");
});
it("zero and tiny nonzero amounts are not misrepresented as zero in compact display", () => {
  equal(compactMoney(0), "¥0");
  equal(compactMoney(0.01), "¥0.000001 万");
  equal(compactMoney("invalid"), "-");
  equal(compactMoney(null), "-");
  equal(compactMoney(undefined), "-");
  equal(compactMoney(""), "-");
});
it("full precision and full hover values survive abbreviation", () => {
  const lines = currencyDisplayRows([{ currency: "CNY", amount: "110500.25" }, { currency: "EUR", amount: "25600.50" }]);
  equal(lines.primary.full, "¥110,500.25");
  equal(lines.primary.compact, "¥11.05 万");
  equal(lines.foreign[0].full, "+ €25,600.5");
  equal(lines.foreign[0].compact, "+ €2.56 万");
  equal(lines.title, "¥110,500.25\n+ €25,600.5");
});
it("currency summary text stays separate from the whole number", () => {
  const lines = currencyDisplayRows([{ currency: "EUR", amount: 25600 }, { currency: "USD", amount: 100 }, { currency: "GBP", amount: 20 }]);
  equal(lines.foreign, [{ full: "+ €25,600", compact: "+ €2.56 万", explanation: "等 3 种" }]);
  equal(lines.title, "¥0\n+ €25,600\n+ GBP 20\n+ USD 100");
});
it("CNY-only and zero foreign data stay as a single row", () => {
  const lines = currencyDisplayRows([{ currency: "CNY", amount: 185500 }, { currency: "EUR", amount: 0 }]);
  equal(lines.foreign, []);
  equal(lines.primary.full, "¥185,500");
});

function equal(actual: unknown, expected: unknown) { expect(actual).toEqual(expected); }
