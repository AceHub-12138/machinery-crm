import Link from "next/link";
import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

import { AnimatedNumber } from "@/components/motion/AnimatedNumber";

import { LoadingSkeleton } from "./loading-skeleton";
import { SurfaceCard } from "./surface-card";

export type MetricCardProps = {
  icon?: ReactNode;
  number?: ReactNode;
  title: string;
  hint?: ReactNode;
  href?: string;
  loading?: boolean;
  error?: boolean | string;
  surface?: "default" | "dashboard";
  animateNumber?: boolean;
  numberFormat?: (value: number) => ReactNode;
  numberPrecision?: number;
};

export function MetricCard({
  icon,
  number,
  title,
  hint,
  href,
  loading = false,
  error = false,
  surface = "default",
  animateNumber = false,
  numberFormat,
  numberPrecision,
}: MetricCardProps) {
  const surfaceVariant = surface === "dashboard"
    ? href ? "dashboardInteractive" : "dashboard"
    : href ? "interactive" : "default";
  const card = (
    <SurfaceCard
      className="h-full p-5"
      variant={surfaceVariant}
    >
      {loading ? (
        <LoadingSkeleton lines={3} />
      ) : error ? (
        <div className="flex min-h-24 items-center gap-3 text-[var(--danger)]">
          <AlertCircle aria-hidden="true" className="size-5 shrink-0" />
          <div>
            <p className="font-medium">{title}</p>
            <p className="mt-1 text-sm">
              {typeof error === "string" ? error : "数据加载失败"}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-[var(--text-secondary)]">{title}</p>
            {number !== undefined && (
              <p className="mt-2 text-3xl font-semibold text-[var(--text-primary)] tabular-nums">
                {animateNumber && typeof number === "number" ? (
                  <AnimatedNumber
                    format={numberFormat}
                    precision={numberPrecision}
                    value={number}
                  />
                ) : number}
              </p>
            )}
            {hint && (
              <div className="mt-2 text-sm text-[var(--text-tertiary)]">
                {hint}
              </div>
            )}
          </div>
          {icon && (
            <div className="shrink-0 text-[var(--brand-orange)]" aria-hidden="true">
              {icon}
            </div>
          )}
        </div>
      )}
    </SurfaceCard>
  );

  return href ? (
    <Link className="block h-full rounded-[var(--radius-lg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]" href={href}>
      {card}
    </Link>
  ) : (
    card
  );
}
