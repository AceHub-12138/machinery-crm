"use client";

import { useEffect, useRef } from "react";
import { currencyLines, type CurrencyAmount } from "@/lib/currency";

/** 固定读数区预留两行外币，不改变卡片高度；先缩字至 14px，再省略。 */
export function CurrencyAmounts({ rows, primarySize = 30, className = "" }: { rows: CurrencyAmount[]; primarySize?: number; className?: string }) {
  const lines = currencyLines(rows);
  const foreignSize = Math.max(14, Math.floor(primarySize * 0.75));
  return <span data-currency-amounts className={className} title={lines.title} style={{ display: "inline-flex", flexDirection: "column", width: "100%", minWidth: 0, height: Math.ceil(primarySize * 1.2 + foreignSize * 2.4), textAlign: "right", fontVariantNumeric: "tabular-nums", overflow: "hidden" }}>
    <FittedAmount text={lines.primary} size={primarySize} />
    {lines.foreign.map(text => <FittedAmount key={text} text={text} title={lines.title} size={foreignSize} secondary />)}
  </span>;
}

function FittedAmount({ text, title = text, size, secondary = false }: { text: string; title?: string; size: number; secondary?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const fit = () => {
      let fontSize = Math.max(14, size);
      element.style.fontSize = `${fontSize}px`;
      while (element.scrollWidth > element.clientWidth && fontSize > 14) element.style.fontSize = `${--fontSize}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, size]);
  return <span ref={ref} data-currency-line={secondary ? "foreign" : "CNY"} title={title} style={{ display: "block", flexShrink: 0, width: "100%", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: Math.max(14, size), lineHeight: "1.2", ...(secondary ? { color: "var(--text-secondary)", fontWeight: 400 } : {}) }}>{text}</span>;
}
