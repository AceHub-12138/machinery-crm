"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

export type ErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
};

export function ErrorState({
  title = "加载失败",
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <section className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-[var(--danger-soft)] text-[var(--danger)]">
        <AlertTriangle aria-hidden="true" className="size-6" />
      </div>
      <h3 className="mt-4 font-medium text-[var(--text-primary)]">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-[var(--text-secondary)]">
        {message}
      </p>
      {onRetry && (
        <button
          aria-label="重新尝试"
          className="mt-5 inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--brand-orange)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-orange-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]"
          onClick={onRetry}
          type="button"
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          重试
        </button>
      )}
    </section>
  );
}
