"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ChevronLeft, ChevronRight, Eye, Search } from "lucide-react";
import { MotionPage } from "@/components/motion/MotionPage";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { SurfaceCard } from "@/components/ui/surface-card";
import { LeadStatusBadge } from "@/components/leads/lead-status-badge";
import { PageContainer } from "@/components/layout/page-container";
import {
  assignLeadsAndRefresh,
  invalidateLeadsAndRefresh,
  loadHumanLeadList,
  loadLeadAssignees,
} from "@/modules/crm/leads/client";
import {
  LEAD_FEEDBACK_REASON_LABELS,
  LEAD_REVIEW_STATUS_LABELS,
  leadFeedbackReasonsForStatus,
  type LeadFeedbackReasonCode,
} from "@/modules/crm/leads/feedback-contract";
import { LEAD_SOURCE_LABELS } from "@/modules/crm/leads/presentation";
import type { HumanLeadListItem, LeadUserSummary } from "@/modules/crm/leads/types";
import { isReducedMotionPreferred, useReducedMotion } from "@/hooks/useReducedMotion";
import { MOTION_DURATION, MOTION_EASE } from "@/lib/motion/config";

gsap.registerPlugin(useGSAP);

function dateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function LeadListClient({ canFilterAssignee }: { canFilterAssignee: boolean }) {
  const [items, setItems] = useState<HumanLeadListItem[]>([]);
  const [activeUsers, setActiveUsers] = useState<LeadUserSummary[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keywordDraft, setKeywordDraft] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [reviewStatus, setReviewStatus] = useState("");
  const [aiScoreMin, setAiScoreMin] = useState("");
  const [aiScoreMax, setAiScoreMax] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkAssigneeId, setBulkAssigneeId] = useState("");
  const [bulkReasonCode, setBulkReasonCode] = useState<LeadFeedbackReasonCode | "">("");
  const [bulkComment, setBulkComment] = useState("");
  const [operating, setOperating] = useState(false);
  const [notice, setNotice] = useState("");
  const [highlightedLeadIds, setHighlightedLeadIds] = useState<Set<string>>(new Set());
  const [assignmentHighlightRun, setAssignmentHighlightRun] = useState(0);
  const handledAssignmentHighlightRunRef = useRef(0);
  const tableRef = useRef<HTMLTableElement>(null);
  const reducedMotion = useReducedMotion();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setSelectedLeadIds(new Set());
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (reviewStatus) params.set("reviewStatus", reviewStatus);
    else params.set("excludeInvalid", "1");
    if (aiScoreMin) params.set("aiScoreMin", aiScoreMin);
    if (aiScoreMax) params.set("aiScoreMax", aiScoreMax);
    if (searchKeyword) params.set("searchKeyword", searchKeyword);
    if (canFilterAssignee && assignedUserId) params.set("assignedUserId", assignedUserId);
    if (createdFrom) params.set("createdFrom", createdFrom);
    if (createdTo) params.set("createdTo", createdTo);
    try {
      const data = await loadHumanLeadList(params);
      setItems(data.items);
      setPagination(data.pagination);
      setSelectedLeadIds(new Set());
    } catch (reason) {
      setItems([]);
      setError(reason instanceof Error ? reason.message : "AI 线索列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [aiScoreMax, aiScoreMin, assignedUserId, canFilterAssignee, createdFrom, createdTo, page, reviewStatus, searchKeyword]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!canFilterAssignee) return;
    const controller = new AbortController();
    loadLeadAssignees((input, init) => fetch(input, { ...init, signal: controller.signal }))
      .then((data) => setActiveUsers(data))
      .catch(() => { if (!controller.signal.aborted) setActiveUsers([]); });
    return () => controller.abort();
  }, [canFilterAssignee]);

  useGSAP(
    () => {
      const highlights = tableRef.current?.querySelectorAll<HTMLSpanElement>(
        "[data-assignment-highlight]",
      );
      if (!highlights || highlights.length === 0) return;

      if (
        assignmentHighlightRun === 0
        || assignmentHighlightRun === handledAssignmentHighlightRunRef.current
      ) {
        gsap.set(highlights, { opacity: 0 });
        return;
      }

      handledAssignmentHighlightRunRef.current = assignmentHighlightRun;
      if (reducedMotion || isReducedMotionPreferred()) {
        gsap.set(highlights, { opacity: 0 });
        return;
      }

      gsap.fromTo(
        highlights,
        { opacity: 1 },
        {
          duration: MOTION_DURATION.process,
          ease: MOTION_EASE.decel,
          opacity: 0,
        },
      );
    },
    {
      dependencies: [assignmentHighlightRun, reducedMotion],
      revertOnUpdate: true,
      scope: tableRef,
    },
  );

  function applyKeyword(event: FormEvent) {
    event.preventDefault();
    resetSelectionForQuery();
    setSearchKeyword(keywordDraft.trim());
  }

  function resetSelectionForQuery() {
    setSelectedLeadIds(new Set());
    setPage(1);
  }

  function resetFilters() {
    setKeywordDraft("");
    setSearchKeyword("");
    setReviewStatus("");
    setAiScoreMin("");
    setAiScoreMax("");
    setAssignedUserId("");
    setCreatedFrom("");
    setCreatedTo("");
    setSelectedLeadIds(new Set());
    setPage(1);
  }

  function toggleLead(leadId: string) {
    setSelectedLeadIds((current) => {
      const next = new Set(current);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }

  function toggleCurrentPage() {
    setSelectedLeadIds((current) => current.size === items.length
      ? new Set()
      : new Set(items.map((lead) => lead.id)));
  }

  const selectedLeads = items.filter((lead) => selectedLeadIds.has(lead.id));

  async function assignSelected() {
    if (!bulkAssigneeId || selectedLeads.length === 0) {
      setError("请选择 Lead 和目标销售负责人");
      return;
    }
    const assignedLeadIds = selectedLeads.map((lead) => lead.id);
    setOperating(true);
    setError("");
    setNotice("");
    try {
      await assignLeadsAndRefresh({
        leadIds: assignedLeadIds,
        assignedUserId: bulkAssigneeId,
        refresh: load,
      });
      setHighlightedLeadIds(new Set(assignedLeadIds));
      setAssignmentHighlightRun((current) => current + 1);
      setNotice(`已完成 ${assignedLeadIds.length} 条 Lead 指派`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "批量指派失败");
    } finally {
      setOperating(false);
    }
  }

  async function invalidateSelected() {
    if (!bulkReasonCode || selectedLeads.length === 0) {
      setError("请选择 Lead 和无效原因");
      return;
    }
    if (bulkReasonCode === "OTHER" && !bulkComment.trim()) {
      setError("选择“其他”原因时必须填写备注");
      return;
    }
    setOperating(true);
    setError("");
    setNotice("");
    try {
      await invalidateLeadsAndRefresh({
        items: selectedLeads.map((lead) => ({
          leadId: lead.id,
          expectedFeedbackVersion: lead.feedbackVersion,
        })),
        reviewReasonCode: bulkReasonCode,
        comment: bulkComment.trim() || undefined,
        refresh: load,
      });
      setBulkReasonCode("");
      setBulkComment("");
      setNotice(`已将 ${selectedLeads.length} 条 Lead 标记为无效`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "批量标记无效失败");
    } finally {
      setOperating(false);
    }
  }

  return (
    <PageContainer variant="data">
      <MotionPage className="space-y-5">
        <header>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">AI 线索池</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">查看 AI 获客线索、评分画像和销售人工反馈记录。</p>
        </header>

      {error && <div className="rounded-[var(--radius-md)] border border-red-200 bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div>}
      {notice && <div className="rounded-[var(--radius-md)] border border-green-200 bg-[var(--success-soft)] px-4 py-3 text-sm text-[var(--success)]">{notice}</div>}

      <SurfaceCard className="p-4">
        <form className="grid gap-3 lg:grid-cols-12" onSubmit={applyKeyword}>
          <div className="relative lg:col-span-3">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <input aria-label="搜索关键词" className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-orange)]" onChange={(event) => setKeywordDraft(event.target.value)} placeholder="搜索获客关键词" value={keywordDraft} />
          </div>
          <select aria-label="反馈状态" className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] px-3 py-2 text-sm lg:col-span-2" onChange={(event) => { setReviewStatus(event.target.value); resetSelectionForQuery(); }} value={reviewStatus}>
            <option value="">全部反馈状态</option>
            {Object.entries(LEAD_REVIEW_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2 lg:col-span-2">
            <input aria-label="AI 评分最小值" className="min-w-0 rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-2 text-sm" max="100" min="0" onChange={(event) => { setAiScoreMin(event.target.value); resetSelectionForQuery(); }} placeholder="最低分" type="number" value={aiScoreMin} />
            <input aria-label="AI 评分最大值" className="min-w-0 rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-2 text-sm" max="100" min="0" onChange={(event) => { setAiScoreMax(event.target.value); resetSelectionForQuery(); }} placeholder="最高分" type="number" value={aiScoreMax} />
          </div>
          {canFilterAssignee && <select aria-label="指派人" className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] px-3 py-2 text-sm lg:col-span-2" onChange={(event) => { setAssignedUserId(event.target.value); resetSelectionForQuery(); }} value={assignedUserId}><option value="">全部指派人</option>{activeUsers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name || entry.email}</option>)}</select>}
          <div className={`${canFilterAssignee ? "lg:col-span-3" : "lg:col-span-5"} grid grid-cols-2 gap-2`}>
            <input aria-label="创建开始日期" className="min-w-0 rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-2 text-sm" onChange={(event) => { setCreatedFrom(event.target.value); resetSelectionForQuery(); }} type="date" value={createdFrom} />
            <input aria-label="创建结束日期" className="min-w-0 rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-2 text-sm" onChange={(event) => { setCreatedTo(event.target.value); resetSelectionForQuery(); }} type="date" value={createdTo} />
          </div>
          <div className="flex gap-2 lg:col-span-12 lg:justify-end">
            <button className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]" onClick={resetFilters} type="button">重置</button>
            <button className="rounded-[var(--radius-sm)] bg-[var(--brand-orange)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-orange-hover)]" type="submit">查询</button>
          </div>
        </form>
      </SurfaceCard>

      {selectedLeads.length > 0 && (
        <SurfaceCard className="flex flex-col gap-3 p-4 xl:flex-row xl:items-end">
          <p className="shrink-0 pb-2 text-sm font-medium text-[var(--text-primary)]">已选择 {selectedLeads.length} 条</p>
          {canFilterAssignee && (
            <div className="flex flex-1 flex-col gap-2 sm:flex-row">
              <select aria-label="批量指派负责人" className="min-w-[220px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] px-3 py-2 text-sm" onChange={(event) => setBulkAssigneeId(event.target.value)} value={bulkAssigneeId}>
                <option value="">选择销售负责人</option>
                {activeUsers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name || entry.email}（{entry.role === "FOREIGN_TRADE" ? "外贸销售" : "销售"}）</option>)}
              </select>
              <button className="whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-4 py-2 text-sm font-medium disabled:opacity-40" disabled={loading || operating || !bulkAssigneeId} onClick={() => void assignSelected()} type="button">批量指派销售</button>
            </div>
          )}
          <div className="flex flex-1 flex-col gap-2 sm:flex-row">
            <select aria-label="批量无效原因" className="min-w-[190px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] px-3 py-2 text-sm" onChange={(event) => setBulkReasonCode(event.target.value as LeadFeedbackReasonCode | "")} value={bulkReasonCode}>
              <option value="">选择无效原因</option>
              {leadFeedbackReasonsForStatus("INVALID").map((reason) => <option key={reason} value={reason}>{LEAD_FEEDBACK_REASON_LABELS[reason]}</option>)}
            </select>
            {bulkReasonCode === "OTHER" && <input aria-label="批量无效备注" className="min-w-[220px] rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-2 text-sm" maxLength={2000} onChange={(event) => setBulkComment(event.target.value)} placeholder="填写无效原因" value={bulkComment} />}
            <button className="whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--danger)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40" disabled={loading || operating || !bulkReasonCode} onClick={() => void invalidateSelected()} type="button">批量标记无效</button>
          </div>
          <button className="whitespace-nowrap rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]" disabled={loading || operating} onClick={() => setSelectedLeadIds(new Set())} type="button">取消选择</button>
        </SurfaceCard>
      )}

      {loading ? (
        <SurfaceCard className="p-5"><LoadingSkeleton lines={8} /></SurfaceCard>
      ) : items.length === 0 ? (
        <SurfaceCard><EmptyState description="当前筛选条件下没有可查看的 AI 线索。" title="暂无 AI 线索" /></SurfaceCard>
      ) : (
        <SurfaceCard className="overflow-x-auto">
          <table className="w-full min-w-[1530px] table-fixed text-sm" ref={tableRef}>
            <thead className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-secondary)]"><tr>
              <th className="w-[52px] whitespace-nowrap px-4 py-3 text-center font-medium"><input aria-label="全选当前页" checked={items.length > 0 && selectedLeadIds.size === items.length} disabled={loading} onChange={toggleCurrentPage} type="checkbox" /></th>
              <th className="w-[270px] whitespace-nowrap px-4 py-3 text-left font-medium">公司 / 联系人</th>
              <th className="w-[190px] whitespace-nowrap px-4 py-3 text-left font-medium">联系方式</th>
              <th className="w-[90px] whitespace-nowrap px-4 py-3 text-left font-medium">AI 评分</th>
              <th className="w-[110px] whitespace-nowrap px-4 py-3 text-left font-medium">反馈状态</th>
              <th className="w-[240px] whitespace-nowrap px-4 py-3 text-left font-medium">获客关键词</th>
              <th className="w-[100px] whitespace-nowrap px-4 py-3 text-left font-medium">来源</th>
              <th className="w-[120px] whitespace-nowrap px-4 py-3 text-left font-medium">指派人</th>
              <th className="w-[170px] whitespace-nowrap px-4 py-3 text-left font-medium">创建时间</th>
              <th className="w-[70px] whitespace-nowrap px-4 py-3 text-left font-medium">版本</th>
              <th className="sticky right-0 w-[70px] whitespace-nowrap bg-[var(--surface-muted)] px-4 py-3 text-center font-medium">操作</th>
            </tr></thead>
            <tbody>{items.map((lead) => <tr className="relative isolate border-b border-[var(--border)] hover:bg-[var(--surface-hover)]" key={lead.id}>
              <td className="w-[52px] whitespace-nowrap px-4 py-3 text-center">{highlightedLeadIds.has(lead.id) && <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[var(--brand-orange-soft)] opacity-0" data-assignment-highlight={lead.id} />}<input aria-label={`选择 ${lead.companyName}`} checked={selectedLeadIds.has(lead.id)} onChange={() => toggleLead(lead.id)} type="checkbox" /></td>
              <td className="w-[270px] px-4 py-3"><p className="truncate whitespace-nowrap font-medium text-[var(--text-primary)]" title={lead.companyName}>{lead.companyName}</p><p className="mt-1 truncate whitespace-nowrap text-xs text-[var(--text-tertiary)]" title={lead.contactName || undefined}>{lead.contactName || "未记录联系人"}</p></td>
              <td className="w-[190px] whitespace-nowrap px-4 py-3 text-[var(--text-secondary)]"><p>{lead.phone || "-"}</p><p className="mt-1 truncate text-xs" title={lead.email || undefined}>{lead.email || "-"}</p></td>
              <td className="w-[90px] whitespace-nowrap px-4 py-3 font-semibold tabular-nums">{lead.aiScore ?? "未评分"}</td>
              <td className="w-[110px] whitespace-nowrap px-4 py-3"><LeadStatusBadge status={lead.reviewStatus} /></td>
              <td className="max-w-[220px] truncate whitespace-nowrap px-4 py-3 text-[var(--text-secondary)]" title={lead.searchKeyword || undefined}>{lead.searchKeyword || "-"}</td>
              <td className="w-[100px] whitespace-nowrap px-4 py-3 text-[var(--text-secondary)]">{LEAD_SOURCE_LABELS[lead.source] || lead.source}</td>
              <td className="w-[120px] truncate whitespace-nowrap px-4 py-3 text-[var(--text-secondary)]" title={lead.assignedUser?.name || lead.assignedUser?.email || "未指派"}>{lead.assignedUser?.name || lead.assignedUser?.email || "未指派"}</td>
              <td className="w-[170px] whitespace-nowrap px-4 py-3 text-[var(--text-secondary)]">{dateTime(lead.createdAt)}</td>
              <td className="w-[70px] whitespace-nowrap px-4 py-3 tabular-nums text-[var(--text-secondary)]">v{lead.feedbackVersion}</td>
              <td className="sticky right-0 w-[70px] whitespace-nowrap bg-[var(--surface-solid)] px-4 py-3 text-center"><Link aria-label={`查看 ${lead.companyName}`} className="inline-flex rounded-lg p-2 text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]" href={`/leads/${lead.id}`}><Eye className="size-4" /></Link></td>
            </tr>)}</tbody>
          </table>
        </SurfaceCard>
      )}

      <div className="flex flex-col gap-3 text-sm text-[var(--text-secondary)] sm:flex-row sm:items-center sm:justify-between">
        <p>共 {pagination.total} 条，第 {pagination.page} / {Math.max(1, pagination.totalPages)} 页</p>
        <div className="flex gap-2">
          <button className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-2 disabled:opacity-40" disabled={loading || page <= 1} onClick={() => { setSelectedLeadIds(new Set()); setPage((value) => Math.max(1, value - 1)); }} type="button"><ChevronLeft className="size-4" />上一页</button>
          <button className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-2 disabled:opacity-40" disabled={loading || pagination.totalPages === 0 || page >= pagination.totalPages} onClick={() => { setSelectedLeadIds(new Set()); setPage((value) => value + 1); }} type="button">下一页<ChevronRight className="size-4" /></button>
        </div>
      </div>
      </MotionPage>
    </PageContainer>
  );
}
