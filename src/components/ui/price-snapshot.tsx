import { formatPriceSnapshotAmount } from "@/lib/currency";

/** 历史快照没有币种：保留纯金额，标签与金额不可拆行。 */
export function PriceSnapshot({ value }: { value: unknown }) {
  const amount = formatPriceSnapshotAmount(value);
  if (amount === "-") return <span>-</span>;
  return (
    <span data-price-snapshot style={{ display: "inline-flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
      <span>{amount}</span>
      <span data-currency-status style={{ fontSize: 12, lineHeight: "16px", color: "var(--text-secondary)", border: "1px solid var(--text-secondary)", borderRadius: 4, padding: "0 6px" }}>币种待确认</span>
    </span>
  );
}
