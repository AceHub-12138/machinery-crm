import type { ReactNode } from "react";

/** Panel表面：左侧品牌强调条 + 统一的头/体结构。 */
export function Panel({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <section className={`panel ${className}`}>{children}</section>;
}

/**
 * 面板头：眉题 + 中文标题 + 右侧指标。
 * 固定 56px 高，保证四块面板标题基线对齐。
 */
export function PanelHead({
  eyebrow,
  title,
  extra,
}: {
  eyebrow: string;
  title: string;
  extra?: ReactNode;
}) {
  return (
    <header className="panel-head shrink-0">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="h-6 w-[3px] shrink-0 rounded-full bg-[var(--brand-orange)]"
        />
        <div className="min-w-0">
          <p className="panel-eyebrow">{eyebrow}</p>
          <h2 className="panel-title screen-text-label mt-1 truncate">{title}</h2>
        </div>
      </div>
      {extra ? <div className="shrink-0 text-right">{extra}</div> : null}
    </header>
  );
}
