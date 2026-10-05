"use client";

import Link from "next/link";
import {
  Bell,
  Boxes,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Pin,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import { SurfaceCard } from "@/components/ui/surface-card";

const tabs = [
  ["inbox", "我的待办"],
  ["approval", "待我审批"],
  ["initiated", "我发起的"],
  ["handled", "已处理"],
] as const;

type TaskView = (typeof tabs)[number][0];
type TaskAction = "READ" | "PIN" | "IGNORE" | "UNIGNORE";

type TaskItem = {
  id: string;
  sourceType: string;
  sourceId: string;
  module: "CRM" | "ERP" | "SYSTEM";
  taskType: string;
  title: string;
  description?: string;
  status: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  initiatorId?: string;
  assigneeId?: string;
  dueAt?: string;
  createdAt: string;
  href: string;
  state?: { readAt?: string | null; pinnedAt?: string | null; ignoredAt?: string | null };
};

const priorityClasses: Record<TaskItem["priority"], string> = {
  LOW: "bg-[var(--neutral-soft)] text-[var(--neutral)]",
  NORMAL: "bg-[var(--info-soft)] text-[var(--info)]",
  HIGH: "bg-[var(--warning-soft)] text-[var(--warning)]",
  URGENT: "bg-[var(--danger-soft)] text-[var(--danger)]",
};

const moduleIcons = {
  CRM: ClipboardList,
  ERP: Boxes,
  SYSTEM: ShieldCheck,
};

function formatDate(value?: string) {
  if (!value) return "未设置";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function isOverdue(task: TaskItem) {
  if (!task.dueAt || task.status !== "PENDING") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(task.dueAt) < today;
}

function initiatorLabel(task: TaskItem) {
  return task.initiatorId ? `用户 ID：${task.initiatorId}` : "系统";
}

function TaskCard({ item, onSelect, selected }: { item: TaskItem; onSelect: () => void; selected: boolean }) {
  const ModuleIcon = moduleIcons[item.module];
  const unread = !item.state?.readAt;

  return (
    <button
      aria-pressed={selected}
      className={`w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)] ${selected ? "rounded-[var(--radius-lg)] ring-2 ring-[var(--brand-orange)]" : ""}`}
      onClick={onSelect}
      type="button"
    >
      <SurfaceCard className="relative p-4" variant="interactive">
        {item.state?.pinnedAt && <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-[var(--warning-soft)] px-2 py-1 text-xs font-medium text-[var(--warning)]"><Pin className="size-3" aria-hidden="true" />置顶</span>}
        <div className="flex min-w-0 items-start gap-3 pr-12">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-muted)] text-[var(--brand-orange)]"><ModuleIcon className="size-4" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {unread && <span aria-label="未读" className="size-2 shrink-0 rounded-full bg-[var(--danger)]" />}
              <h2 className="min-w-0 font-medium text-[var(--text-primary)]">{item.title}</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${priorityClasses[item.priority]}`}>{item.priority}</span>
              <StatusBadge status={item.status} />
              {isOverdue(item) && <span className="rounded-full bg-[var(--danger-soft)] px-2 py-0.5 text-xs font-medium text-[var(--danger)]">已逾期</span>}
            </div>
            <p className="mt-2 line-clamp-2 text-sm text-[var(--text-secondary)]">{item.description || "待处理业务事项"}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-tertiary)]">
              <span>发起人：{initiatorLabel(item)}</span>
              {item.dueAt && <span>截止：{formatDate(item.dueAt)}</span>}
              <span>创建：{formatDate(item.createdAt)}</span>
            </div>
          </div>
        </div>
      </SurfaceCard>
    </button>
  );
}

function TaskDetail({ item, busy, onAction }: { item: TaskItem; busy: boolean; onAction: (action: TaskAction) => void }) {
  const ModuleIcon = moduleIcons[item.module];
  const actionButton = "rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-solid)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <SurfaceCard className="h-fit p-5 md:sticky md:top-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-muted)] text-[var(--brand-orange)]"><ModuleIcon className="size-5" aria-hidden="true" /></span>
        <div className="min-w-0"><h2 className="font-semibold text-[var(--text-primary)]">{item.title}</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">{item.description || "待处理业务事项"}</p></div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2"><StatusBadge status={item.status} /><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${priorityClasses[item.priority]}`}>{item.priority}</span>{isOverdue(item) && <span className="rounded-full bg-[var(--danger-soft)] px-2.5 py-1 text-xs font-medium text-[var(--danger)]">已逾期</span>}</div>
      <dl className="mt-5 space-y-3 text-sm"><div><dt className="text-[var(--text-tertiary)]">模块</dt><dd className="mt-1 text-[var(--text-primary)]">{item.module}</dd></div><div><dt className="text-[var(--text-tertiary)]">类型</dt><dd className="mt-1 break-all text-[var(--text-primary)]">{item.taskType}</dd></div><div><dt className="text-[var(--text-tertiary)]">发起人</dt><dd className="mt-1 break-all text-[var(--text-primary)]">{initiatorLabel(item)}</dd></div>{item.assigneeId && <div><dt className="text-[var(--text-tertiary)]">处理人 ID</dt><dd className="mt-1 break-all text-[var(--text-primary)]">{item.assigneeId}</dd></div>}<div><dt className="text-[var(--text-tertiary)]">截止时间</dt><dd className="mt-1 text-[var(--text-primary)]">{formatDate(item.dueAt)}</dd></div><div><dt className="text-[var(--text-tertiary)]">创建时间</dt><dd className="mt-1 text-[var(--text-primary)]">{formatDate(item.createdAt)}</dd></div></dl>
      <Link className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-[var(--brand-orange)] hover:text-[var(--brand-orange-hover)]" href={item.href}><ExternalLink className="size-4" aria-hidden="true" />进入业务入口</Link>
      <div className="mt-5 border-t border-[var(--border)] pt-4"><p className="text-sm font-medium text-[var(--text-primary)]">任务操作</p><div className="mt-3 flex flex-wrap gap-2">{!item.state?.readAt && <button className={actionButton} disabled={busy} onClick={() => onAction("READ")} type="button"><CheckCircle2 className="mr-1 inline size-4" aria-hidden="true" />标记已读</button>}{!item.state?.pinnedAt && <button className={actionButton} disabled={busy} onClick={() => onAction("PIN")} type="button"><Pin className="mr-1 inline size-4" aria-hidden="true" />置顶</button>}{item.state?.ignoredAt ? <button className={actionButton} disabled={busy} onClick={() => onAction("UNIGNORE")} type="button">恢复</button> : <button className={actionButton} disabled={busy} onClick={() => onAction("IGNORE")} type="button">忽略</button>}</div></div>
    </SurfaceCard>
  );
}

export default function TasksPage() {
  const [view, setView] = useState<TaskView>("inbox");
  const [items, setItems] = useState<TaskItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadTasks = useCallback(async () => {
    await Promise.resolve();
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/system/tasks?view=${view}`);
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.items)) throw new Error(data.error || "待办加载失败");
      setItems(data.items);
      setSelectedId((current) => data.items.some((item: TaskItem) => item.id === current) ? current : data.items[0]?.id);
    } catch (loadError) {
      setItems([]); setSelectedId(undefined); setError(loadError instanceof Error ? loadError.message : "待办加载失败");
    } finally { setLoading(false); }
  }, [view]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadTasks(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadTasks]);

  const changeView = (nextView: TaskView) => {
    setStatusFilter("ALL");
    setView(nextView);
  };

  const visibleItems = useMemo(() => statusFilter === "ALL" ? items : items.filter((item) => item.status === statusFilter), [items, statusFilter]);
  const selected = visibleItems.find((item) => item.id === selectedId) ?? visibleItems[0];
  const statuses = useMemo(() => [...new Set(items.map((item) => item.status))], [items]);

  const updateTask = async (action: TaskAction) => {
    if (!selected) return;
    setBusy(true); setActionError("");
    try {
      const response = await fetch("/api/system/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceType: selected.sourceType, sourceId: selected.sourceId, action }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "待办状态更新失败");
      await loadTasks();
    } catch (updateError) {
      setActionError(updateError instanceof Error ? updateError.message : "待办状态更新失败，请重试。");
    } finally { setBusy(false); }
  };

  return (
    <PageContainer className="space-y-5" variant="data">
      <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">我的工作</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">统一查看待办与审批，原有业务状态机保持不变</p></div><Link className="inline-flex items-center gap-1 text-sm font-medium text-[var(--brand-orange)] hover:text-[var(--brand-orange-hover)]" href="/tasks/monthly">月任务视图 →</Link></header>
      <SurfaceCard className="p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div className="md:hidden"><SegmentedControl options={tabs.map(([value, label]) => ({ value, label }))} value={view} onChange={(value) => changeView(value as TaskView)} /></div><label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">状态<select className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-solid)] px-2 py-1 text-[var(--text-primary)]" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">全部</option>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label></div></SurfaceCard>
      {actionError && <div aria-live="polite" className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)] shadow-[var(--shadow-float)]"><Bell className="size-4" aria-hidden="true" />{actionError}</div>}
      {loading ? <SurfaceCard className="p-5"><LoadingSkeleton lines={8} /></SurfaceCard> : error ? <SurfaceCard className="p-1"><ErrorState message={error} onRetry={() => void loadTasks()} /></SurfaceCard> : visibleItems.length === 0 ? <SurfaceCard className="p-1"><EmptyState title="暂无任务" description="当前视图和状态筛选下没有可见事项。" /></SurfaceCard> : <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1.15fr)_minmax(280px,0.85fr)]"><aside className="hidden md:block"><SurfaceCard className="p-3"><p className="px-2 pb-2 text-sm font-medium text-[var(--text-primary)]">任务视图</p><div aria-label="任务视图" className="space-y-1" role="tablist">{tabs.map(([key, label]) => <button aria-selected={view === key} className={`w-full rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm font-medium ${view === key ? "bg-[var(--surface-muted)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"}`} key={key} onClick={() => changeView(key)} role="tab" type="button">{label}</button>)}</div><p className="mt-4 px-2 text-sm text-[var(--text-tertiary)]">共 {visibleItems.length} 项</p></SurfaceCard></aside><section aria-label="任务列表" className="space-y-3">{visibleItems.map((item) => <div key={item.id} className="space-y-3"><TaskCard item={item} onSelect={() => setSelectedId(item.id)} selected={selected?.id === item.id} />{selected?.id === item.id && <div className="md:hidden"><TaskDetail busy={busy} item={item} onAction={(action) => void updateTask(action)} /></div>}</div>)}</section><aside aria-label="任务详情" className="hidden md:block">{selected && <TaskDetail busy={busy} item={selected} onAction={(action) => void updateTask(action)} />}</aside></div>}
    </PageContainer>
  );
}
