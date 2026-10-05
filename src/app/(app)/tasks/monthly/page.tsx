"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { SurfaceCard } from "@/components/ui/surface-card";

type MonthlyTask = {
  sourceType: string;
  sourceId: string;
  module: "CRM" | "ERP" | "SYSTEM";
  taskType: string;
  title: string;
  status: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  dueAt?: string;
  createdAt: string;
  dateField: "dueAt" | "createdAt";
  href: string;
};

type TaskGroup = "overdue" | "today" | "week" | "later";

const GROUP_LABELS: Record<TaskGroup, string> = {
  overdue: "已逾期",
  today: "今日",
  week: "本周",
  later: "本月稍后",
};

function formatMonth(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string) {
  const [year, value] = month.split("-");
  return `${year} 年 ${Number(value)} 月`;
}

function shiftMonth(month: string, offset: number) {
  const [year, value] = month.split("-").map(Number);
  return formatMonth(new Date(year, value - 1 + offset, 1));
}

function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function taskDate(task: MonthlyTask) {
  return new Date(task.dueAt || task.createdAt);
}

function groupForTask(task: MonthlyTask): TaskGroup {
  const today = startOfDay(new Date());
  const date = startOfDay(taskDate(task));
  const weekEnd = new Date(today);
  weekEnd.setDate(today.getDate() + 6);

  if (date < today) return "overdue";
  if (date.getTime() === today.getTime()) return "today";
  if (date <= weekEnd) return "week";
  return "later";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(value));
}

export default function MonthlyTasksPage() {
  const [month, setMonth] = useState(() => formatMonth(new Date()));
  const [items, setItems] = useState<MonthlyTask[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/system/tasks/monthly?month=${month}`);
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.items)) {
        throw new Error(data.error || "月任务加载失败");
      }
      setItems(data.items);
    } catch (loadError) {
      setItems([]);
      setError(loadError instanceof Error ? loadError.message : "月任务加载失败");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const groups = useMemo(() => {
    const result: Record<TaskGroup, MonthlyTask[]> = {
      overdue: [],
      today: [],
      week: [],
      later: [],
    };
    items.forEach((item) => result[groupForTask(item)].push(item));
    return result;
  }, [items]);

  return (
    <PageContainer className="space-y-6" variant="data">
      <header className="space-y-2">
        <nav aria-label="面包屑" className="text-sm text-[var(--text-secondary)]">
          <Link className="hover:text-[var(--text-primary)]" href="/tasks">我的工作</Link>
          <span className="mx-2" aria-hidden="true">/</span>
          <span className="text-[var(--text-primary)]">月任务</span>
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">月任务</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">按计划日期或发起日期汇总当前可见事项。</p>
          </div>
          <div className="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] p-1 shadow-[var(--shadow-card)]">
            <button aria-label="上个月" className="rounded-[var(--radius-sm)] p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]" onClick={() => setMonth((value) => shiftMonth(value, -1))} type="button"><ChevronLeft className="size-4" /></button>
            <span aria-live="polite" className="min-w-28 px-3 text-center text-sm font-medium text-[var(--text-primary)]">{monthLabel(month)}</span>
            <button aria-label="下个月" className="rounded-[var(--radius-sm)] p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]" onClick={() => setMonth((value) => shiftMonth(value, 1))} type="button"><ChevronRight className="size-4" /></button>
          </div>
        </div>
      </header>

      {loading ? <SurfaceCard className="p-5"><LoadingSkeleton lines={6} /></SurfaceCard> : error ? <SurfaceCard className="p-1"><ErrorState message={error} onRetry={() => void loadTasks()} /></SurfaceCard> : items.length === 0 ? <SurfaceCard className="p-1"><EmptyState title="本月暂无任务" description="切换月份查看其他时间范围内的可见事项。" /></SurfaceCard> : <div className="space-y-6">{(Object.keys(GROUP_LABELS) as TaskGroup[]).map((group) => groups[group].length > 0 && <section key={group} className="space-y-3"><h2 className="text-sm font-semibold text-[var(--text-secondary)]">{GROUP_LABELS[group]} <span className="font-normal">{groups[group].length}</span></h2><div className="space-y-3">{groups[group].map((item) => <Link key={`${item.sourceType}:${item.sourceId}`} href={item.href} className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]"><SurfaceCard variant="interactive" className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium text-[var(--text-primary)]">{item.title}</h3><StatusBadge status={item.status} /></div><p className="mt-2 text-sm text-[var(--text-secondary)]">{item.module} · {item.taskType}</p></div><span className="rounded-full bg-[var(--neutral-soft)] px-2.5 py-1 text-xs font-medium text-[var(--neutral)]">{item.priority}</span></div><p className="mt-3 text-sm text-[var(--text-secondary)]">{item.dateField === "dueAt" ? "计划日期" : "发起日期"}：{formatDate(item.dueAt || item.createdAt)}</p></SurfaceCard></Link>)}</div></section>)}</div>}
    </PageContainer>
  );
}
