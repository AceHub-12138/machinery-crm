"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { MotionPage } from "@/components/motion/MotionPage";
import { StaggerContainer } from "@/components/motion/StaggerContainer";
import { Button } from "@/components/ui/button";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { SurfaceCard } from "@/components/ui/surface-card";
import { LeadProfilePresentation } from "@/components/leads/lead-profile-presentation";
import { LeadStatusBadge } from "@/components/leads/lead-status-badge";
import { PageContainer } from "@/components/layout/page-container";
import {
  assignLeadsAndRefresh,
  LeadHumanApiError,
  loadLeadAssignees,
  refreshHumanLeadDetail,
  submitLeadFeedbackAndRefresh,
} from "@/modules/crm/leads/client";
import {
  HUMAN_LEAD_REVIEW_STATUSES,
  LEAD_FEEDBACK_REASON_LABELS,
  LEAD_REVIEW_STATUS_LABELS,
  leadFeedbackReasonsForStatus,
  requiresLeadFeedbackComment,
  type HumanLeadReviewStatus,
  type LeadFeedbackReasonCode,
} from "@/modules/crm/leads/feedback-contract";
import { historicalLeadStatusLabel, LEAD_SOURCE_LABELS, safeLeadSourceUrl } from "@/modules/crm/leads/presentation";
import type { HumanLeadDetail, LeadUserSummary } from "@/modules/crm/leads/types";
import { isReducedMotionPreferred, useReducedMotion } from "@/hooks/useReducedMotion";
import { MOTION_DURATION, MOTION_EASE, MOTION_STAGGER_INTERVAL } from "@/lib/motion/config";

gsap.registerPlugin(useGSAP);

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
}

function userName(user: LeadUserSummary | null, fallbackId?: string | null) {
  return user?.name || user?.email || fallbackId || "未记录";
}

function InfoItem({
  highlightRef,
  label,
  value,
}: {
  highlightRef?: Ref<HTMLSpanElement>;
  label: string;
  value: React.ReactNode;
}) {
  const displayedValue = value === null || value === undefined || value === "" ? "-" : value;
  return <div className="relative">{highlightRef && <span aria-hidden className="pointer-events-none absolute -inset-2 rounded-[var(--radius-sm)] bg-[var(--brand-orange-soft)] opacity-0" data-assignment-highlight="true" ref={highlightRef} />}<dt className="relative text-xs text-[var(--text-tertiary)]">{label}</dt><dd className="relative mt-1 break-words text-sm text-[var(--text-primary)]">{displayedValue}</dd></div>;
}

export function LeadDetailClient({ leadId, canAssign }: { leadId: string; canAssign: boolean }) {
  const [lead, setLead] = useState<HumanLeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewStatus, setReviewStatus] = useState<HumanLeadReviewStatus | "">("");
  const [reviewReasonCode, setReviewReasonCode] = useState<LeadFeedbackReasonCode | "">("");
  const [comment, setComment] = useState("");
  const [assignees, setAssignees] = useState<LeadUserSummary[]>([]);
  const [assignmentTarget, setAssignmentTarget] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignmentHighlightRun, setAssignmentHighlightRun] = useState(0);
  const assignmentHighlightRef = useRef<HTMLSpanElement>(null);
  const handledAssignmentHighlightRunRef = useRef(0);
  const reducedMotion = useReducedMotion();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await refreshHumanLeadDetail({
        leadId,
        apply: (nextLead) => {
          setLead(nextLead);
          setAssignmentTarget(nextLead?.assignedUserId || "");
        },
      });
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI 线索详情加载失败");
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!canAssign) return;
    const controller = new AbortController();
    loadLeadAssignees((input, init) => fetch(input, { ...init, signal: controller.signal }))
      .then(setAssignees)
      .catch(() => { if (!controller.signal.aborted) setAssignees([]); });
    return () => controller.abort();
  }, [canAssign]);

  const reasonOptions = useMemo(
    () => reviewStatus ? leadFeedbackReasonsForStatus(reviewStatus) : [],
    [reviewStatus],
  );

  useGSAP(
    () => {
      const highlight = assignmentHighlightRef.current;
      if (!highlight) return;

      if (
        assignmentHighlightRun === 0
        || assignmentHighlightRun === handledAssignmentHighlightRunRef.current
      ) {
        gsap.set(highlight, { opacity: 0 });
        return;
      }

      handledAssignmentHighlightRunRef.current = assignmentHighlightRun;
      if (reducedMotion || isReducedMotionPreferred()) {
        gsap.set(highlight, { opacity: 0 });
        return;
      }

      gsap.fromTo(
        highlight,
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
      scope: assignmentHighlightRef,
    },
  );

  async function submitFeedback(event: FormEvent) {
    event.preventDefault();
    if (!lead || !reviewStatus || !reviewReasonCode) {
      setError("请选择反馈状态和原因");
      return;
    }
    if (requiresLeadFeedbackComment(reviewReasonCode) && !comment.trim()) {
      setError("选择“其他”原因时必须填写备注");
      return;
    }
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      await submitLeadFeedbackAndRefresh({
        leadId,
        feedback: {
          reviewStatus,
          reviewReasonCode,
          comment: comment.trim() || undefined,
          expectedFeedbackVersion: lead.feedbackVersion,
        },
        refresh: load,
      });
      setReviewStatus("");
      setReviewReasonCode("");
      setComment("");
      setNotice("反馈已保存，线索状态和历史记录已刷新");
    } catch (reason) {
      setError(reason instanceof LeadHumanApiError ? reason.message : "反馈提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  async function assignLead() {
    if (!lead || !assignmentTarget) {
      setError("请选择销售负责人");
      return;
    }
    setAssigning(true);
    setError("");
    setNotice("");
    try {
      await assignLeadsAndRefresh({
        leadIds: [lead.id],
        assignedUserId: assignmentTarget,
        refresh: load,
      });
      setAssignmentHighlightRun((current) => current + 1);
      setNotice("Lead 负责人已更新");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Lead 分配失败");
    } finally {
      setAssigning(false);
    }
  }

  if (loading && !lead) return <PageContainer><SurfaceCard className="p-6"><LoadingSkeleton lines={10} /></SurfaceCard></PageContainer>;
  if (!lead) return <PageContainer><SurfaceCard className="p-6"><p className="text-sm text-[var(--danger)]">{error || "线索不存在或已不可访问"}</p><Link className="mt-4 inline-flex text-sm text-[var(--brand-orange)]" href="/leads">返回 AI 线索池</Link></SurfaceCard></PageContainer>;

  const sourceUrl = safeLeadSourceUrl(lead.sourceUrl);

  return (
    <PageContainer className="space-y-5" variant="data">
      <MotionPage>
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><Link className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]" href="/leads"><ArrowLeft className="size-4" />返回 AI 线索池</Link><h1 className="mt-2 text-xl font-semibold text-[var(--text-primary)]">{lead.companyName}</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">{lead.contactName || "未记录联系人"}</p></div>
          <div className="flex items-center gap-2"><LeadStatusBadge status={lead.reviewStatus} /><button aria-label="刷新详情" className="rounded-[var(--radius-sm)] border border-[var(--border)] p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]" onClick={() => void load()} type="button"><RefreshCw className="size-4" /></button></div>
        </header>
      </MotionPage>

      {error && <div className="rounded-[var(--radius-md)] border border-red-200 bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div>}
      {notice && <div className="rounded-[var(--radius-md)] border border-green-200 bg-[var(--success-soft)] px-4 py-3 text-sm text-[var(--success)]">{notice}</div>}

      <div className="grid gap-5 xl:grid-cols-3">
        <StaggerContainer className="space-y-5 xl:col-span-2">
          <SurfaceCard className="p-5"><h2 className="font-semibold">线索信息</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><InfoItem label="联系人" value={lead.contactName} /><InfoItem label="电话" value={lead.phone} /><InfoItem label="邮箱" value={lead.email} /><InfoItem label="AI 评分" value={lead.aiScore == null ? "未评分" : <AnimatedNumber value={lead.aiScore} />} /><InfoItem label="获客关键词" value={lead.searchKeyword} /><InfoItem label="来源" value={LEAD_SOURCE_LABELS[lead.source] || lead.source} /><InfoItem label="创建时间" value={dateTime(lead.createdAt)} /><InfoItem highlightRef={assignmentHighlightRef} label="当前指派" value={lead.assignedUserId ? userName(lead.assignedUser, lead.assignedUserId) : "未指派"} /><InfoItem label="反馈版本" value={`v${lead.feedbackVersion}`} /></dl>{sourceUrl && <a className="mt-4 inline-flex items-center gap-1 text-sm text-[var(--brand-orange)] hover:underline" href={sourceUrl} rel="noreferrer" target="_blank">查看来源页面<ExternalLink className="size-3.5" /></a>}</SurfaceCard>
          <SurfaceCard className="p-5"><h2 className="font-semibold">AI 画像</h2><LeadProfilePresentation profile={lead.profile} /></SurfaceCard>
          <SurfaceCard className="p-5"><h2 className="font-semibold">来源与模型</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2"><InfoItem label="来源" value={LEAD_SOURCE_LABELS[lead.source] || lead.source} /><InfoItem label="来源 URL" value={sourceUrl || "未记录或链接不可用"} /><InfoItem label="获客关键词" value={lead.searchKeyword} /><InfoItem label="模型版本" value={lead.sourceModelVersion} /><InfoItem label="提取器版本" value={lead.extractorVersion} /><InfoItem label="最后更新时间" value={dateTime(lead.updatedAt)} /></dl></SurfaceCard>
          <SurfaceCard className="p-5"><h2 className="font-semibold">历史反馈</h2>{lead.feedbackEvents.length === 0 ? <p className="mt-4 text-sm text-[var(--text-secondary)]">暂无人工反馈记录。</p> : <ol className="mt-5 space-y-4">{lead.feedbackEvents.map((feedbackEvent) => <li className="relative border-l-2 border-[var(--border)] pl-5" key={feedbackEvent.id}><span className="absolute -left-[5px] top-1.5 size-2 rounded-full bg-[var(--brand-orange)]" /><div className="flex flex-wrap items-center gap-2"><LeadStatusBadge label={historicalLeadStatusLabel(feedbackEvent.reviewStatus)} status={feedbackEvent.reviewStatus || "PENDING"} /><span className="text-xs text-[var(--text-tertiary)]">{dateTime(feedbackEvent.reviewedAt)}</span></div><p className="mt-2 text-sm font-medium text-[var(--text-primary)]">{feedbackEvent.reviewReasonCode ? LEAD_FEEDBACK_REASON_LABELS[feedbackEvent.reviewReasonCode as LeadFeedbackReasonCode] || feedbackEvent.reviewReasonCode : "未记录原因"}</p><p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-secondary)]">{feedbackEvent.comment || "无备注"}</p><p className="mt-2 text-xs text-[var(--text-tertiary)]">反馈人：{userName(feedbackEvent.reviewedByUser, feedbackEvent.reviewedByUserId)}</p></li>)}</ol>}</SurfaceCard>
        </StaggerContainer>

        <StaggerContainer className="space-y-5" delay={MOTION_STAGGER_INTERVAL}>
          {canAssign && <SurfaceCard className="p-5"><h2 className="font-semibold">分配 / 改派负责人</h2><p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">候选人只包含真实启用的销售与外贸销售账号。</p><select aria-label="Lead 负责人" className="mt-4 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] px-3 py-2 text-sm" onChange={(event) => setAssignmentTarget(event.target.value)} value={assignmentTarget}><option value="">请选择销售负责人</option>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name || assignee.email}（{assignee.role === "FOREIGN_TRADE" ? "外贸销售" : "销售"}）</option>)}</select><Button className="mt-3 w-full" disabled={assigning || !assignmentTarget || assignmentTarget === lead.assignedUserId} onClick={() => void assignLead()} type="button">{assigning ? "保存中..." : lead.assignedUserId ? "确认改派" : "确认分配"}</Button></SurfaceCard>}
          <SurfaceCard className="p-5"><h2 className="font-semibold">当前反馈摘要</h2><dl className="mt-4 space-y-4"><InfoItem label="状态" value={LEAD_REVIEW_STATUS_LABELS[lead.reviewStatus] || lead.reviewStatus} /><InfoItem label="最近反馈人" value={userName(lead.reviewedByUser, lead.reviewedByUserId)} /><InfoItem label="最近反馈时间" value={dateTime(lead.reviewedAt)} /><InfoItem label="反馈版本" value={lead.feedbackVersion} /></dl></SurfaceCard>
          <SurfaceCard className="p-5"><h2 className="font-semibold">提交人工反馈</h2><p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">每次提交都会追加历史事件，不会创建正式客户。</p><form className="mt-5 space-y-4" onSubmit={submitFeedback}><label className="block text-sm"><span className="mb-1 block text-[var(--text-secondary)]">反馈状态</span><select className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] px-3 py-2" onChange={(event) => { setReviewStatus(event.target.value as HumanLeadReviewStatus | ""); setReviewReasonCode(""); }} value={reviewStatus}><option value="">请选择</option>{HUMAN_LEAD_REVIEW_STATUSES.map((status) => <option key={status} value={status}>{LEAD_REVIEW_STATUS_LABELS[status]}</option>)}</select></label><label className="block text-sm"><span className="mb-1 block text-[var(--text-secondary)]">原因</span><select className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] px-3 py-2 disabled:bg-[var(--surface-muted)]" disabled={!reviewStatus} onChange={(event) => setReviewReasonCode(event.target.value as LeadFeedbackReasonCode | "")} value={reviewReasonCode}><option value="">请选择</option>{reasonOptions.map((reason) => <option key={reason} value={reason}>{LEAD_FEEDBACK_REASON_LABELS[reason]}</option>)}</select></label><label className="block text-sm"><span className="mb-1 block text-[var(--text-secondary)]">备注{reviewReasonCode === "OTHER" ? " *" : "（可选）"}</span><textarea className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] px-3 py-2" maxLength={2000} onChange={(event) => setComment(event.target.value)} placeholder={reviewReasonCode === "OTHER" ? "请填写具体原因" : "补充本次人工判断"} rows={4} value={comment} /></label><Button className="w-full" disabled={submitting || !reviewStatus || !reviewReasonCode} type="submit">{submitting ? "提交中..." : `提交反馈（当前 v${lead.feedbackVersion}）`}</Button></form></SurfaceCard>
        </StaggerContainer>
      </div>
    </PageContainer>
  );
}
