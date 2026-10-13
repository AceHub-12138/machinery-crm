"use client";

import { useEffect, useRef } from "react";
import { currencyDisplayRows, type CurrencyDisplayLine, type CurrencyAmount } from "@/lib/currency";

/** 固定读数区预留两行外币；金额先缩至 12px，再缩写为万/亿，数字不省略。 */
export function CurrencyAmounts({ rows, primarySize = 30, className = "" }: { rows: CurrencyAmount[]; primarySize?: number; className?: string }) {
  const lines = currencyDisplayRows(rows);
  const foreignSize = Math.max(14, Math.floor(primarySize * 0.75));
  return <span data-currency-amounts className={className} title={lines.title} style={{ display: "inline-flex", flexDirection: "column", width: "100%", minWidth: 0, height: Math.ceil(primarySize * 1.2 + foreignSize * 2.4), textAlign: "right", fontVariantNumeric: "tabular-nums", overflow: "hidden" }}>
    <FittedAmount line={lines.primary} title={lines.primary.full} size={primarySize} />
    {lines.foreign.map(line => <FittedAmount key={line.full} line={line} title={lines.title} size={foreignSize} secondary />)}
  </span>;
}

function FittedAmount({ line, title, size, secondary = false }: { line: CurrencyDisplayLine; title: string; size: number; secondary?: boolean }) {
  const rowRef = useRef<HTMLSpanElement>(null);
  const amountRef = useRef<HTMLSpanElement>(null);
  const explanationRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const row = rowRef.current;
    const amount = amountRef.current;
    if (!row || !amount) return;
    let disposed = false;
    const fit = () => {
      if (disposed) return;
      let fontSize = Math.max(12, size);
      amount.textContent = line.full;
      amount.style.fontSize = `${fontSize}px`;
      amount.dataset.amountFormat = "full";
      while (amount.scrollWidth > row.clientWidth && fontSize > 12) amount.style.fontSize = `${--fontSize}px`;
      if (amount.scrollWidth > row.clientWidth) {
        amount.textContent = line.compact;
        amount.dataset.amountFormat = "compact";
      }
      const explanation = explanationRef.current;
      if (explanation) {
        const remaining = Math.max(0, row.clientWidth - amount.getBoundingClientRect().width);
        const gap = remaining > 6 ? 6 : 0;
        explanation.style.marginLeft = `${gap}px`;
        explanation.style.maxWidth = `${Math.max(0, remaining - gap)}px`;
      }
      // 极窄容器连缩写也容不下时，完整数字可水平滚动，绝不省略或裁掉字符。
      amount.tabIndex = amount.scrollWidth > amount.clientWidth ? 0 : -1;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    document.fonts?.ready.then(fit);
    return () => { disposed = true; observer.disconnect(); };
  }, [line.full, line.compact, size]);
  return <span ref={rowRef} data-currency-line={secondary ? "foreign" : "CNY"} title={title} style={{ display: "flex", flexShrink: 0, alignItems: "baseline", justifyContent: "flex-end", width: "100%", minWidth: 0, whiteSpace: "nowrap", fontSize: Math.max(12, size), lineHeight: "1.2", ...(secondary ? { color: "var(--text-secondary)", fontWeight: 400 } : {}) }}>
    <span ref={amountRef} data-currency-number data-amount-format="full" data-full-amount={line.full} title={title} style={{ display: "block", flexShrink: 0, maxWidth: "100%", minWidth: 0, whiteSpace: "nowrap", overflowX: "auto", scrollbarWidth: "none", textOverflow: "clip" }}>{line.full}</span>
    {line.explanation && <span ref={explanationRef} data-currency-explanation title={title} style={{ marginLeft: 0, maxWidth: 0, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontSize: 12 }}>{line.explanation}</span>}
  </span>;
}
