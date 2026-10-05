"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageContainer } from "@/components/layout/page-container";

/**
 * 获客助手（仅超管）：新建获客任务 → 服务端异步跑「关键词→百度搜索→AI评分→(反查)」，
 * 前端每 3 秒轮询任务详情；评分达标候选人工勾选后入池（写 AI 线索池并按省自动分单）。
 * 样式与 Agent 管理保持一致。
 */

const cardClass = "rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-4 shadow-[var(--shadow-card)]";
const primaryButtonClass = "rounded-[var(--radius-md)] bg-[var(--brand-orange)] px-4 py-2 text-sm text-white hover:bg-[var(--brand-orange-hover)] disabled:opacity-50";
const secondaryButtonClass = "rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50";
const inputClass = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#EE7D2C] focus:ring-2 focus:ring-[#EE7D2C]/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

const TASK_STATUS_LABELS: Record<string, { text: string; className: string }> = {
  running: { text: "进行中", className: "bg-blue-50 text-blue-700" },
  done: { text: "已完成", className: "bg-emerald-50 text-emerald-700" },
  failed: { text: "失败", className: "bg-red-50 text-red-700" },
  cancelled: { text: "已取消", className: "bg-gray-100 text-gray-600" },
};

const CANDIDATE_STATUS_LABELS: Record<string, { text: string; className: string }> = {
  PENDING_CONFIRM: { text: "待确认", className: "bg-amber-50 text-amber-700" },
  ADMITTED: { text: "已入池", className: "bg-emerald-50 text-emerald-700" },
  NO_CONTACT: { text: "无联系方式-待反查", className: "bg-sky-50 text-sky-700" },
  LOOKING_UP: { text: "反查中", className: "bg-indigo-50 text-indigo-700" },
  LOOKUP_FOUND: { text: "反查成功", className: "bg-emerald-50 text-emerald-700" },
  LOOKUP_FAILED: { text: "反查无果", className: "bg-gray-100 text-gray-600" },
  DISCARDED: { text: "低分归档", className: "bg-red-50 text-red-600" },
};

const PHASE_LABELS: Record<string, string> = {
  keywords: "生成关键词",
  searching: "百度搜索中",
  scoring: "AI 评分中",
  lookup: "天眼查反查中",
  done: "已完成",
};

const ADMITTABLE = ["PENDING_CONFIRM", "NO_CONTACT", "LOOKUP_FOUND", "LOOKUP_FAILED"];

type TaskListItem = {
  id: string;
  status: string;
  config: TaskConfig;
  progress: TaskProgress | null;
  report: TaskReport | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { candidates: number };
  admittedCount: number;
};

type TaskConfig = {
  goal: string;
  maxRounds: number;
  pagesPerRound: number;
  keywordIterations: number;
  passingScore: number;
  dailyLookupLimit: number;
  lookupMode: "MANUAL" | "AUTO";
};

type TaskProgress = {
  currentRound: number;
  totalRounds: number;
  phase: string;
  currentKeywords: string[];
  roundSummaries: Array<{ round: number; keywords: string[]; candidates: number; qualified: number; parseFailed: number }>;
};

type TaskReport = {
  totalCandidates: number;
  admitted: number;
  discarded: number;
  lookupCalls: number;
  finishedAt: string | null;
};

type Candidate = {
  id: string;
  companyName: string;
  sourceUrl: string | null;
  score: number | null;
  scoreReason: string | null;
  phone: string | null;
  email: string | null;
  province: string | null;
  city: string | null;
  round: number | null;
  status: string;
  leadId: string | null;
};

type Detail = {
  task: {
    id: string;
    status: string;
    config: TaskConfig;
    progress: TaskProgress | null;
    report: TaskReport | null;
    error: string | null;
    createdAt: string;
    candidates: Candidate[];
  };
  stats: Record<string, number>;
};

const defaultForm: TaskConfig = {
  goal: "",
  maxRounds: 3,
  pagesPerRound: 3,
  keywordIterations: 2,
  passingScore: 70,
  dailyLookupLimit: 20,
  lookupMode: "MANUAL",
};

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function Badge({ status, labels }: { status: string; labels: Record<string, { text: string; className: string }> }) {
  const label = labels[status] ?? { text: status, className: "bg-gray-100 text-gray-600" };
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${label.className}`}>{label.text}</span>;
}

export function LeadHunterClient() {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [fakeSearchMode, setFakeSearchMode] = useState(false);
  const [form, setForm] = useState<TaskConfig>(defaultForm);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      const response = await fetch("/api/lead-hunter/tasks");
      if (!response.ok) return;
      const data = await response.json();
      setTasks(data.tasks ?? []);
      setFakeSearchMode(Boolean(data.fakeSearchMode));
    } catch {
      // 瞬时网络/服务抖动：保持当前列表，下次刷新/轮询自愈
    }
  }, []);

  const loadDetail = useCallback(async (taskId: string, silent = false) => {
    try {
      if (!silent) setDetail(null);
      const response = await fetch(`/api/lead-hunter/tasks/${taskId}`);
      if (!response.ok) return;
      const data = await response.json();
      setDetail(data);
      setChecked(new Set());
    } catch {
      // 瞬时网络/服务抖动：保持当前详情，下次轮询自愈
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  // 任务进行中：每 3 秒轮询详情（页面数据全部来自库，服务重启中断也能看到兜底状态）
  useEffect(() => {
    if (!selectedId || detail?.task.status !== "running") return;
    const timer = setInterval(() => {
      void loadDetail(selectedId, true);
      void loadTasks();
    }, 3000);
    return () => clearInterval(timer);
  }, [selectedId, detail?.task.status, loadDetail, loadTasks]);

  const selectTask = (taskId: string) => {
    setSelectedId(taskId);
    setMessage(null);
    void loadDetail(taskId);
  };

  const createTask = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/lead-hunter/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "创建失败");
      setMessage({ kind: "ok", text: "任务已创建并开始执行" });
      setForm({ ...defaultForm });
      await loadTasks();
      selectTask(data.id);
    } catch (error) {
      setMessage({ kind: "err", text: error instanceof Error ? error.message : "创建失败" });
    } finally {
      setBusy(false);
    }
  };

  const cancelTask = async (taskId: string) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/lead-hunter/tasks/${taskId}/cancel`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "取消失败");
      await Promise.all([loadTasks(), selectedId === taskId ? loadDetail(taskId, true) : Promise.resolve()]);
    } catch (error) {
      setMessage({ kind: "err", text: error instanceof Error ? error.message : "取消失败" });
    } finally {
      setBusy(false);
    }
  };

  const rerunTask = async (taskId: string) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/lead-hunter/tasks/${taskId}/rerun`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "重新执行失败");
      await loadTasks();
      selectTask(data.id);
    } catch (error) {
      setMessage({ kind: "err", text: error instanceof Error ? error.message : "重新执行失败" });
    } finally {
      setBusy(false);
    }
  };

  const candidates = useMemo(() => detail?.task.candidates ?? [], [detail]);
  const checkedAdmittable = useMemo(
    () => candidates.filter((candidate) => checked.has(candidate.id) && ADMITTABLE.includes(candidate.status)),
    [candidates, checked],
  );
  const checkedLookupable = useMemo(
    () => candidates.filter((candidate) => checked.has(candidate.id) && candidate.status === "NO_CONTACT"),
    [candidates, checked],
  );

  const toggleChecked = (candidateId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  };

  const reverseLookup = async () => {
    if (checkedLookupable.length < 1 || !detail) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/lead-hunter/tasks/${detail.task.id}/reverse-lookup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateIds: checkedLookupable.map((candidate) => candidate.id) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "反查失败");
      setMessage({ kind: "ok", text: `反查完成：成功 ${data.found} 条、无果 ${data.failed} 条` });
      await loadDetail(detail.task.id, true);
    } catch (error) {
      setMessage({ kind: "err", text: error instanceof Error ? error.message : "反查失败" });
    } finally {
      setBusy(false);
    }
  };

  const admit = async () => {
    if (checkedAdmittable.length < 1 || !detail) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/lead-hunter/tasks/${detail.task.id}/admit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateIds: checkedAdmittable.map((candidate) => candidate.id) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "入池失败");
      const assigned = data.results?.filter((item: { assignedUserId: string | null }) => item.assignedUserId).length ?? 0;
      setMessage({ kind: "ok", text: `已入池 ${data.admitted} 条，其中 ${assigned} 条已按省份自动分配销售；可在「AI 线索池」查看` });
      await Promise.all([loadDetail(detail.task.id, true), loadTasks()]);
    } catch (error) {
      setMessage({ kind: "err", text: error instanceof Error ? error.message : "入池失败" });
    } finally {
      setBusy(false);
    }
  };

  const progress = detail?.task.progress ?? null;
  const report = detail?.task.report ?? null;
  const stats = detail?.stats ?? {};

  return (
    <PageContainer variant="data" className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">获客助手</h1>
        <p className="text-sm text-gray-500">
          按目标客户描述自动「AI 关键词 → 百度搜索 → AI 评分」，评分达标的公司人工确认后入池 AI 线索池，并按省份自动分配给对应销售。
        </p>
      </div>

      {message && (
        <div className={`rounded-lg border p-3 text-sm ${message.kind === "ok" ? "border-emerald-200 bg-emerald-50/60 text-emerald-700" : "border-red-200 bg-red-50/60 text-red-700"}`}>
          {message.text}
        </div>
      )}

      {/* 区 1：新建任务 */}
      <div className={cardClass}>
        <h2 className="text-base font-semibold">新建获客任务</h2>
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">目标客户描述（大白话）</label>
            <textarea
              className={`${inputClass} min-h-20`}
              placeholder="例：帮我找浙江省做联轴器、键槽加工的厂家"
              value={form.goal}
              onChange={(event) => setForm({ ...form, goal: event.target.value })}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium">搜索轮数（1-5）</label>
              <input type="number" min={1} max={5} className={inputClass} value={form.maxRounds}
                onChange={(event) => setForm({ ...form, maxRounds: Number(event.target.value) })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">每轮结果条数（1-10）</label>
              <input type="number" min={1} max={10} className={inputClass} value={form.pagesPerRound}
                onChange={(event) => setForm({ ...form, pagesPerRound: Number(event.target.value) })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">关键词迭代轮数（0-3）</label>
              <input type="number" min={0} max={3} className={inputClass} value={form.keywordIterations}
                onChange={(event) => setForm({ ...form, keywordIterations: Number(event.target.value) })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">评分及格线（0-100）</label>
              <input type="number" min={0} max={100} className={inputClass} value={form.passingScore}
                onChange={(event) => setForm({ ...form, passingScore: Number(event.target.value) })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">天眼查每日反查上限</label>
              <input type="number" min={0} max={200} className={inputClass} value={form.dailyLookupLimit}
                onChange={(event) => setForm({ ...form, dailyLookupLimit: Number(event.target.value) })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">反查模式</label>
              <select className={inputClass} value={form.lookupMode}
                onChange={(event) => setForm({ ...form, lookupMode: event.target.value as "MANUAL" | "AUTO" })}>
                <option value="MANUAL">人工勾选后反查（推荐）</option>
                <option value="AUTO">自动反查（按上限）</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={primaryButtonClass} disabled={busy || form.goal.trim().length < 5} onClick={() => void createTask()}>
              创建并开始执行
            </button>
            <p className="text-xs text-gray-500">
              {fakeSearchMode
                ? "当前为演示假搜索模式：不消耗百度额度，返回固定样例数据。"
                : "真实搜索：每次任务约消耗百度搜索「轮数 × 每轮关键词数(3~5)」次，请留意每日免费额度。"}
              {form.lookupMode === "AUTO" && " 自动反查将按每日上限自动调用天眼查。"}
            </p>
          </div>
        </div>
      </div>

      {/* 区 2：任务列表 */}
      <div className={cardClass}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">任务列表</h2>
          <button type="button" className={secondaryButtonClass} onClick={() => void loadTasks()}>刷新</button>
        </div>
        <div className="mt-3 overflow-x-auto">
          {tasks.length < 1 ? (
            <p className="py-6 text-center text-sm text-gray-500">还没有任务，先在上面创建一个。</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-gray-500">
                  <th className="py-2 pr-3 font-medium">状态</th>
                  <th className="py-2 pr-3 font-medium">目标客户描述</th>
                  <th className="py-2 pr-3 font-medium">候选/入池</th>
                  <th className="py-2 pr-3 font-medium">创建时间</th>
                  <th className="py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="py-2 pr-3"><Badge status={task.status} labels={TASK_STATUS_LABELS} /></td>
                    <td className="max-w-72 py-2 pr-3">
                      <button type="button" className="text-left hover:text-[var(--brand-orange)]" onClick={() => selectTask(task.id)}>
                        {task.config.goal}
                      </button>
                      {task.error && <p className="text-xs text-red-600">{task.error}</p>}
                    </td>
                    <td className="py-2 pr-3">{task._count.candidates} / {task.admittedCount}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-gray-500">{formatTime(task.createdAt)}</td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button type="button" className={secondaryButtonClass} onClick={() => selectTask(task.id)}>查看详情</button>
                        {task.status === "running" && (
                          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => void cancelTask(task.id)}>取消</button>
                        )}
                        {(task.status === "failed" || task.status === "cancelled") && (
                          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => void rerunTask(task.id)}>重新执行</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 区 3：任务详情 */}
      {detail && (
        <div className={cardClass}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">任务详情</h2>
            <div className="flex items-center gap-2">
              <Badge status={detail.task.status} labels={TASK_STATUS_LABELS} />
              {detail.task.status === "running" && (
                <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => void cancelTask(detail.task.id)}>取消任务</button>
              )}
              {(detail.task.status === "failed" || detail.task.status === "cancelled") && (
                <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => void rerunTask(detail.task.id)}>重新执行</button>
              )}
            </div>
          </div>
          <p className="mt-1 text-sm text-gray-500">{detail.task.config.goal}</p>
          {detail.task.error && <p className="mt-2 rounded-lg border border-red-200 bg-red-50/60 p-3 text-sm text-red-700">{detail.task.error}</p>}

          {/* 轮次进展 */}
          <div className="mt-4 rounded-lg border border-[var(--border)] p-3">
            <p className="text-sm font-medium">
              {detail.task.status === "running"
                ? `第 ${progress?.currentRound ?? 0} / ${progress?.totalRounds ?? detail.task.config.maxRounds} 轮 · ${PHASE_LABELS[progress?.phase ?? ""] ?? "准备中"}`
                : `共 ${progress?.roundSummaries.length ?? 0} 轮`}
            </p>
            {progress?.currentKeywords && progress.currentKeywords.length > 0 && (
              <p className="mt-1 text-xs text-gray-500">当前关键词：{progress.currentKeywords.join("、")}</p>
            )}
            {progress && progress.roundSummaries.length > 0 && (
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-1 pr-3 font-medium">轮次</th>
                    <th className="py-1 pr-3 font-medium">关键词</th>
                    <th className="py-1 pr-3 font-medium">候选</th>
                    <th className="py-1 pr-3 font-medium">达标</th>
                    <th className="py-1 font-medium">AI解析失败</th>
                  </tr>
                </thead>
                <tbody>
                  {progress.roundSummaries.map((summary) => (
                    <tr key={summary.round} className="border-t border-[var(--border)]">
                      <td className="py-1 pr-3">第 {summary.round} 轮</td>
                      <td className="py-1 pr-3">{summary.keywords.join("、")}</td>
                      <td className="py-1 pr-3">{summary.candidates}</td>
                      <td className="py-1 pr-3">{summary.qualified}</td>
                      <td className="py-1">{summary.parseFailed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 候选清单 */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" className={secondaryButtonClass} disabled={busy || checkedLookupable.length < 1} onClick={() => void reverseLookup()}>
              反查电话（已勾 {checkedLookupable.length} 条待反查）
            </button>
            <button type="button" className={primaryButtonClass} disabled={busy || checkedAdmittable.length < 1} onClick={() => void admit()}>
              入池（已勾 {checkedAdmittable.length} 条）
            </button>
            <button type="button" className={secondaryButtonClass} onClick={() => setChecked(new Set(candidates.filter((candidate) => ADMITTABLE.includes(candidate.status)).map((candidate) => candidate.id)))}>
              全选可入池
            </button>
            <button type="button" className={secondaryButtonClass} onClick={() => setChecked(new Set())}>取消勾选</button>
          </div>
          <div className="mt-2 overflow-x-auto">
            {candidates.length < 1 ? (
              <p className="py-6 text-center text-sm text-gray-500">
                {detail.task.status === "running" ? "正在搜索，候选会实时出现在这里…" : "该任务没有产出候选。"}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs text-gray-500">
                    <th className="py-2 pr-2 font-medium"><span className="sr-only">勾选</span></th>
                    <th className="py-2 pr-3 font-medium">公司</th>
                    <th className="py-2 pr-3 font-medium">评分</th>
                    <th className="py-2 pr-3 font-medium">评分理由</th>
                    <th className="py-2 pr-3 font-medium">电话</th>
                    <th className="py-2 pr-3 font-medium">省市</th>
                    <th className="py-2 pr-3 font-medium">状态</th>
                    <th className="py-2 font-medium">轮次</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => {
                    const checkable = ADMITTABLE.includes(candidate.status);
                    return (
                      <tr key={candidate.id} className="border-b border-[var(--border)] last:border-0 align-top">
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            className="mt-1"
                            disabled={!checkable}
                            checked={checked.has(candidate.id)}
                            onChange={() => toggleChecked(candidate.id)}
                          />
                        </td>
                        <td className="py-2 pr-3">
                          {candidate.sourceUrl
                            ? <a href={candidate.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--brand-orange)]">{candidate.companyName}</a>
                            : candidate.companyName}
                        </td>
                        <td className="py-2 pr-3 font-medium">{candidate.score ?? "—"}</td>
                        <td className="max-w-64 py-2 pr-3 text-xs text-gray-500">{candidate.scoreReason ?? "—"}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{candidate.phone ?? "—"}</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-500">{[candidate.province, candidate.city].filter(Boolean).join(" ") || "—"}</td>
                        <td className="py-2 pr-3"><Badge status={candidate.status} labels={CANDIDATE_STATUS_LABELS} /></td>
                        <td className="py-2 text-gray-500">{candidate.round ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* 底部报告 */}
          <div className="mt-4 grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-3 text-sm md:grid-cols-4">
            <p>候选总数：<span className="font-semibold">{report?.totalCandidates ?? detail.task.candidates.length}</span></p>
            <p>已入池：<span className="font-semibold text-emerald-600">{stats.ADMITTED ?? 0}</span></p>
            <p>低分归档：<span className="font-semibold text-red-500">{report?.discarded ?? stats.DISCARDED ?? 0}</span></p>
            <p>天眼查调用：<span className="font-semibold">{report?.lookupCalls ?? 0}</span> 次</p>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
