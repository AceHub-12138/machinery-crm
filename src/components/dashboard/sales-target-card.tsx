"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { CheckCircle2, RefreshCw, Settings2, Target } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SurfaceCard } from "@/components/ui/surface-card";

type PeriodType = "MONTH" | "YEAR";
type TargetMetric = "CONTRACT_AMOUNT" | "PAID_AMOUNT";

type SalesTargetItem = {
  id: string;
  periodType: PeriodType;
  periodYear: number;
  periodIndex: number;
  metric: TargetMetric;
  amount: string;
  salesUserId: string | null;
  note?: string | null;
  actualAmount: string | null;
  completionRate: number | null;
  visualRate: number | null;
  remainingAmount: string | null;
  exceededAmount: string | null;
  exceeded: boolean | null;
  updatedAt: string;
};

type SalesTargetResponse = {
  period: { type: PeriodType; year: number; index: number; label: string };
  targets: SalesTargetItem[];
};

type SalesUserOption = { id: string; name: string };

export type SalesTargetCardProps = {
  currentUserId?: string;
  isSuperAdmin?: boolean;
  salesUsers?: SalesUserOption[];
};

const periodOptions = [
  { value: "MONTH", label: "月度" },
  { value: "YEAR", label: "年度" },
];
const metricOptions = [
  { value: "CONTRACT_AMOUNT", label: "合同额" },
  { value: "PAID_AMOUNT", label: "回款额" },
];
const fieldClassName =
  "h-10 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-solid)] px-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--brand-orange)] focus:ring-2 focus:ring-[var(--brand-orange-soft)]";

function formatMoney(value: string | number | null | undefined) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(value?: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "暂无更新时间";
}

async function readJson(response: Response) {
  return response.json().catch(() => ({}));
}

export function SalesTargetCard({ currentUserId, isSuperAdmin = false, salesUsers = [] }: SalesTargetCardProps) {
  const today = useMemo(() => new Date(), []);
  const [periodType, setPeriodType] = useState<PeriodType>("MONTH");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [metric, setMetric] = useState<TargetMetric>("CONTRACT_AMOUNT");
  const [scopeUserId, setScopeUserId] = useState(isSuperAdmin ? "" : currentUserId || "");
  const [response, setResponse] = useState<SalesTargetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({
    periodType: "MONTH" as PeriodType,
    year: today.getFullYear(),
    month: today.getMonth() + 1,
    metric: "CONTRACT_AMOUNT" as TargetMetric,
    salesUserId: "",
    amount: "",
    note: "",
  });
  const gradientId = useId().replace(/:/g, "");

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ periodType, year: String(year), metric });
      if (periodType === "MONTH") params.set("month", String(month));
      const request = await fetch(`/api/crm/sales-targets?${params}`, { cache: "no-store", signal });
      const payload = await readJson(request);
      if (!request.ok) throw new Error(payload.error || `销售目标加载失败（${request.status}）`);
      setResponse(payload as SalesTargetResponse);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setResponse(null);
      setError(reason instanceof Error ? reason.message : "销售目标加载失败");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [metric, month, periodType, year]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load, refreshToken]);

  const effectiveScopeUserId = isSuperAdmin ? scopeUserId : currentUserId || scopeUserId;
  const selectedTarget = useMemo(() => {
    const targets = response?.targets || [];
    if (isSuperAdmin) {
      return targets.find((item) => (item.salesUserId || "") === effectiveScopeUserId)
        || targets.find((item) => item.salesUserId === null);
    }
    return targets.find((item) => item.salesUserId === currentUserId);
  }, [currentUserId, effectiveScopeUserId, isSuperAdmin, response?.targets]);
  const configured = Boolean(selectedTarget && selectedTarget.actualAmount !== null);

  const openDialog = () => {
    setSaveError("");
    setForm({
      periodType,
      year,
      month,
      metric,
      salesUserId: effectiveScopeUserId,
      amount: selectedTarget?.amount || "",
      note: selectedTarget?.note || "",
    });
    setDialogOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setSaveError("");
    try {
      const request = await fetch("/api/crm/sales-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodType: form.periodType,
          periodYear: form.year,
          periodIndex: form.periodType === "MONTH" ? form.month : 0,
          metric: form.metric,
          amount: form.amount,
          salesUserId: form.salesUserId || null,
          note: form.note || null,
        }),
      });
      const payload = await readJson(request);
      if (!request.ok) throw new Error(payload.error || `销售目标保存失败（${request.status}）`);
      setDialogOpen(false);
      setPeriodType(form.periodType);
      setYear(form.year);
      setMonth(form.month);
      setMetric(form.metric);
      setScopeUserId(form.salesUserId);
      setNotice("销售目标已保存");
      setRefreshToken((value) => value + 1);
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "销售目标保存失败");
    } finally {
      setSaving(false);
    }
  };

  const currentYear = today.getFullYear();
  const yearOptions = Array.from({ length: 11 }, (_, index) => currentYear - 5 + index);
  const visualRate = selectedTarget?.visualRate || 0;
  const radius = 51;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - visualRate / 100);

  return (
    <>
      {notice && (
        <div className="fixed right-4 top-20 z-[60] flex items-center gap-2 rounded-[var(--radius-md)] border border-emerald-500/25 bg-emerald-50/95 px-4 py-3 text-sm font-medium text-emerald-700 shadow-[var(--shadow-float)] backdrop-blur dark:bg-emerald-950/90 dark:text-emerald-200" role="status">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          {notice}
        </div>
      )}

      <SurfaceCard className="flex h-full min-h-[592px] min-w-0 flex-col p-5 sm:p-6" variant="dashboard">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Target className="size-5 text-[var(--brand-orange)]" aria-hidden="true" />
              <h2 className="font-semibold text-[var(--text-primary)]">销售目标达成率</h2>
            </div>
            <p className="mt-1 text-sm text-[var(--text-tertiary)]">{response?.period.label || `${year}年${periodType === "MONTH" ? `${month}月` : ""}`}</p>
          </div>
          {isSuperAdmin && <Button onClick={openDialog} size="sm" variant="secondary"><Settings2 className="size-4" />设置目标</Button>}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="overflow-x-auto pb-1"><SegmentedControl options={periodOptions} value={periodType} onChange={(value) => setPeriodType(value as PeriodType)} /></div>
          <div className="overflow-x-auto pb-1 sm:text-right"><SegmentedControl options={metricOptions} value={metric} onChange={(value) => setMetric(value as TargetMetric)} /></div>
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            年份
            <select className={`${fieldClassName} mt-1`} value={year} onChange={(event) => setYear(Number(event.target.value))}>
              {yearOptions.map((item) => <option key={item} value={item}>{item}年</option>)}
            </select>
          </label>
          {periodType === "MONTH" ? (
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              月份
              <select className={`${fieldClassName} mt-1`} value={month} onChange={(event) => setMonth(Number(event.target.value))}>
                {Array.from({ length: 12 }, (_, index) => index + 1).map((item) => <option key={item} value={item}>{item}月</option>)}
              </select>
            </label>
          ) : <div />}
          {isSuperAdmin && (
            <label className="text-xs font-medium text-[var(--text-secondary)] sm:col-span-2">
              目标范围
              <select className={`${fieldClassName} mt-1`} value={scopeUserId} onChange={(event) => setScopeUserId(event.target.value)}>
                <option value="">全公司</option>
                {salesUsers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {loading && !response ? (
            <div className="my-auto py-10"><LoadingSkeleton lines={6} /></div>
          ) : error ? (
            <div className="my-auto"><ErrorState message={error} onRetry={() => setRefreshToken((value) => value + 1)} title="销售目标暂时无法加载" /></div>
          ) : !configured ? (
            <div className="my-auto flex flex-col items-center py-8 text-center">
              <div className="flex size-[190px] items-center justify-center rounded-full border-[10px] border-[var(--surface-muted)] text-2xl font-semibold text-[var(--text-tertiary)] sm:size-[220px]">
                待设置
              </div>
              <p className="mt-6 text-sm font-medium text-[var(--text-primary)]">尚未设置当前范围的{periodType === "MONTH" ? "月度" : "年度"}销售目标</p>
            </div>
          ) : selectedTarget ? (
            <>
              <div className="mt-6 flex justify-center">
                <div className="relative size-[190px] sm:size-[220px]">
                  <svg aria-label={`目标完成率 ${selectedTarget.completionRate}%`} className="size-full -rotate-90" role="img" viewBox="0 0 120 120">
                    <defs>
                      <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="1">
                        <stop offset="0%" stopColor="var(--brand-orange)" />
                        <stop offset="100%" stopColor="var(--warning)" />
                      </linearGradient>
                    </defs>
                    <circle cx="60" cy="60" fill="none" r={radius} stroke="var(--surface-muted)" strokeWidth="9" />
                    <circle
                      cx="60"
                      cy="60"
                      fill="none"
                      r={radius}
                      stroke={`url(#${gradientId})`}
                      strokeDasharray={circumference}
                      strokeDashoffset={dashOffset}
                      strokeLinecap="round"
                      strokeWidth="9"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center px-5 text-center">
                    <p className="text-4xl font-semibold text-[var(--text-primary)] tabular-nums sm:text-[2.75rem]">{selectedTarget.completionRate}%</p>
                    <p className="mt-2 text-xs text-[var(--text-tertiary)]">已完成</p>
                    <p className="mt-1 max-w-full truncate text-sm font-semibold text-[var(--brand-orange)] tabular-nums sm:text-base">{formatMoney(selectedTarget.actualAmount)}</p>
                    {selectedTarget.exceeded && <p className="mt-1 text-xs font-medium text-[var(--success)]">超额完成</p>}
                  </div>
                </div>
              </div>

              <dl className="mt-6 grid gap-2 text-sm">
                <div className="dashboard-subcard flex items-center justify-between gap-4 rounded-[var(--radius-sm)] px-4 py-3 backdrop-blur-md backdrop-saturate-[1.04]">
                  <dt className="text-[var(--text-secondary)]">目标金额</dt><dd className="font-semibold text-[var(--text-primary)] tabular-nums">{formatMoney(selectedTarget.amount)}</dd>
                </div>
                <div className="dashboard-subcard flex items-center justify-between gap-4 rounded-[var(--radius-sm)] px-4 py-3 backdrop-blur-md backdrop-saturate-[1.04]">
                  <dt className="text-[var(--text-secondary)]">实际{metric === "PAID_AMOUNT" ? "回款" : "合同"}金额</dt><dd className="font-semibold text-[var(--text-primary)] tabular-nums">{formatMoney(selectedTarget.actualAmount)}</dd>
                </div>
                <div className="dashboard-subcard flex items-center justify-between gap-4 rounded-[var(--radius-sm)] px-4 py-3 backdrop-blur-md backdrop-saturate-[1.04]">
                  <dt className="text-[var(--text-secondary)]">{selectedTarget.exceeded ? "超额金额" : "距离目标"}</dt><dd className={`font-semibold tabular-nums ${selectedTarget.exceeded ? "text-[var(--success)]" : "text-[var(--warning)]"}`}>{formatMoney(selectedTarget.exceeded ? selectedTarget.exceededAmount : selectedTarget.remainingAmount)}</dd>
                </div>
              </dl>
            </>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
          <p className="text-xs text-[var(--text-tertiary)]">最后更新：{formatDateTime(selectedTarget?.updatedAt)}</p>
          <Button disabled={loading} onClick={() => setRefreshToken((value) => value + 1)} size="compact" variant="ghost">
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />刷新
          </Button>
        </div>
      </SurfaceCard>

      <Dialog
        description="目标保存后只刷新销售目标卡；金额按平台 Decimal(14,2) 规范校验。"
        footer={(
          <>
            <Button disabled={saving} onClick={() => setDialogOpen(false)} variant="secondary">取消</Button>
            <Button disabled={saving} onClick={() => void save()}>{saving ? "保存中..." : "保存目标"}</Button>
          </>
        )}
        onClose={() => { if (!saving) setDialogOpen(false); }}
        open={dialogOpen}
        title="设置销售目标"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-[var(--text-secondary)]">周期类型
            <select className={`${fieldClassName} mt-1`} value={form.periodType} onChange={(event) => setForm((value) => ({ ...value, periodType: event.target.value as PeriodType }))}>
              <option value="MONTH">月度</option><option value="YEAR">年度</option>
            </select>
          </label>
          <label className="text-sm text-[var(--text-secondary)]">年份
            <select className={`${fieldClassName} mt-1`} value={form.year} onChange={(event) => setForm((value) => ({ ...value, year: Number(event.target.value) }))}>
              {yearOptions.map((item) => <option key={item} value={item}>{item}年</option>)}
            </select>
          </label>
          {form.periodType === "MONTH" && (
            <label className="text-sm text-[var(--text-secondary)]">月份
              <select className={`${fieldClassName} mt-1`} value={form.month} onChange={(event) => setForm((value) => ({ ...value, month: Number(event.target.value) }))}>
                {Array.from({ length: 12 }, (_, index) => index + 1).map((item) => <option key={item} value={item}>{item}月</option>)}
              </select>
            </label>
          )}
          <label className="text-sm text-[var(--text-secondary)]">指标
            <select className={`${fieldClassName} mt-1`} value={form.metric} onChange={(event) => setForm((value) => ({ ...value, metric: event.target.value as TargetMetric }))}>
              <option value="CONTRACT_AMOUNT">合同金额</option><option value="PAID_AMOUNT">回款金额</option>
            </select>
          </label>
          <label className="text-sm text-[var(--text-secondary)] sm:col-span-2">目标范围
            <select className={`${fieldClassName} mt-1`} value={form.salesUserId} onChange={(event) => setForm((value) => ({ ...value, salesUserId: event.target.value }))}>
              <option value="">全公司</option>
              {salesUsers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="text-sm text-[var(--text-secondary)] sm:col-span-2">目标金额
            <input className={`${fieldClassName} mt-1`} inputMode="decimal" min="0.01" placeholder="例如 1000000.00" step="0.01" type="number" value={form.amount} onChange={(event) => setForm((value) => ({ ...value, amount: event.target.value }))} />
          </label>
          <label className="text-sm text-[var(--text-secondary)] sm:col-span-2">备注（可选）
            <textarea className={`${fieldClassName} mt-1 min-h-20 py-2`} value={form.note} onChange={(event) => setForm((value) => ({ ...value, note: event.target.value }))} />
          </label>
        </div>
        {saveError && <div className="mt-4 rounded-[var(--radius-sm)] border border-red-500/20 bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]" role="alert">{saveError}</div>}
      </Dialog>
    </>
  );
}
