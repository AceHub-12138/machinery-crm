"use client";

import { useEffect, useRef } from "react";

/** 先将完整标题从 14px 缩至 12px，再使用调用方提供的短标题。 */
export function SingleLineMetricTitle({ title, shortTitle, hasIcon = false }: { title: string; shortTitle?: string; hasIcon?: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const fit = () => {
      let size = 14;
      element.textContent = title;
      element.style.fontSize = `${size}px`;
      while (element.scrollWidth > element.clientWidth && size > 12) element.style.fontSize = `${--size}px`;
      if (element.scrollWidth > element.clientWidth && shortTitle) element.textContent = shortTitle;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    document.fonts?.ready.then(fit);
    return () => observer.disconnect();
  }, [title, shortTitle]);
  return <p ref={ref} data-metric-title title={title} aria-label={title} className="text-[var(--text-secondary)]" style={{ width: hasIcon ? "calc(100% - 22px)" : "100%", fontSize: 14, lineHeight: "20px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</p>;
}
