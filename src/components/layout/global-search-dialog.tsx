"use client";

import {
  Boxes,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Navigation,
  Package,
  Search,
  ShoppingCart,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";

import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import type {
  SearchResult,
  SearchResultType,
} from "@/modules/global-search/types";

export type GlobalSearchDialogProps = {
  open: boolean;
  onOpenChange: (value: boolean) => void;
};

const ICONS: Record<SearchResultType, LucideIcon> = {
  nav: Navigation,
  customer: Users,
  contract: FileText,
  product: Package,
  material: Boxes,
  "purchase-order": ShoppingCart,
  "production-order": ClipboardCheck,
  "after-sales-order": ClipboardList,
};

export function GlobalSearchDialog({
  open,
  onOpenChange,
}: GlobalSearchDialogProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const userRole = session?.user?.role || "";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryToken, setRetryToken] = useState(0);
  const keyword = query.trim();

  useEffect(() => {
    if (!open || !userRole || keyword.length < 2) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(keyword)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          results?: SearchResult[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || `搜索失败（${response.status}）`);
        }
        setSelectedIndex(0);
        setResults(Array.isArray(payload.results) ? payload.results : []);
      } catch (reason) {
        if (controller.signal.aborted) return;
        setResults([]);
        setError(reason instanceof Error ? reason.message : "全局搜索失败");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [keyword, open, retryToken, userRole]);

  const visibleGroups = useMemo(
    () => results.map((item, index) => ({
      item,
      index,
      showGroup: index === 0 || results[index - 1].group !== item.group,
    })),
    [results],
  );

  function navigateTo(result: SearchResult) {
    router.push(result.href);
    onOpenChange(false);
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    setResults([]);
    setSelectedIndex(0);
    setError("");
    setLoading(value.trim().length >= 2 && Boolean(userRole));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      navigateTo(results[selectedIndex]);
    }
  }

  return (
    <Dialog
      description="搜索你有权限查看的导航、客户、合同、产品和 ERP 记录。"
      onClose={() => onOpenChange(false)}
      open={open}
      title="全局搜索"
    >
      <div onKeyDown={handleKeyDown}>
        <label className="flex h-11 items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-solid)] px-3 focus-within:border-[var(--brand-orange)] focus-within:ring-2 focus-within:ring-[var(--brand-orange-soft)]">
          <Search aria-hidden="true" className="size-[18px] shrink-0 text-[var(--text-tertiary)]" />
          <span className="sr-only">搜索关键词</span>
          <input
            aria-controls="global-search-results"
            aria-expanded={results.length > 0}
            aria-label="搜索关键词"
            autoComplete="off"
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
            onChange={(event) => handleQueryChange(event.target.value)}
            placeholder="搜索客户、合同、产品…"
            role="combobox"
            type="search"
            value={query}
          />
          <span className="rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">Ctrl+K</span>
        </label>

        <div className="mt-4 max-h-[min(55vh,480px)] overflow-y-auto" id="global-search-results" role="listbox">
          {loading ? (
            <p className="px-4 py-12 text-center text-sm text-[var(--text-secondary)]" role="status">正在搜索…</p>
          ) : error ? (
            <ErrorState
              message={error}
              onRetry={() => setRetryToken((value) => value + 1)}
              title="搜索暂时不可用"
            />
          ) : keyword.length === 0 ? (
            <EmptyState
              description="输入客户名称、合同编号、产品型号或 ERP 单号。"
              title="输入关键词搜索(Ctrl+K)"
            />
          ) : keyword.length < 2 ? (
            <EmptyState title="请输入至少 2 个字" />
          ) : results.length === 0 ? (
            <EmptyState
              description="请更换关键词，或确认当前账号是否有对应模块权限。"
              title="未找到结果"
            />
          ) : (
            visibleGroups.map(({ item, index, showGroup }) => {
              const Icon = ICONS[item.type];
              return (
                <Fragment key={`${item.type}:${item.id}`}>
                  {showGroup && (
                    <p className="px-3 pb-1 pt-3 text-xs font-medium text-[var(--text-tertiary)] first:pt-0">{item.group}</p>
                  )}
                  <button
                    aria-selected={selectedIndex === index}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                      selectedIndex === index
                        ? "bg-[var(--brand-orange-soft)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                    }`}
                    onClick={() => navigateTo(item)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    role="option"
                    type="button"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-muted)] text-[var(--brand-orange)]">
                      <Icon aria-hidden="true" className="size-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.title}</span>
                      {item.subtitle && (
                        <span className="mt-0.5 block truncate text-xs text-[var(--text-tertiary)]">{item.subtitle}</span>
                      )}
                    </span>
                  </button>
                </Fragment>
              );
            })
          )}
        </div>
      </div>
    </Dialog>
  );
}
