"use client";
import { useCallback, useEffect, useState } from "react";
import type { HumanLeadDetail, HumanLeadListItem } from "@/modules/crm/leads/types";
import { contactEvidenceSummary, phoneSourceLabel } from "@/modules/crm/leads/contact-presentation";
import { runContactLookups } from "@/modules/crm/leads/contact-client";

const button = "rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-40";
const lookupStatusLabels: Record<string, string> = { RUNNING: "反查中", FOUND: "反查成功", NEEDS_CONFIRM: "待人工确认", NOT_FOUND: "反查无果", FAILED: "反查失败", ADOPTED: "已采用", REJECTED: "已驳回" };
const card = "space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-solid)] p-4";
type Lookup = { id: string; status: string; queryName: string; matchedName: string | null; reason: string | null; creditCode: string | null; regStatus: string | null; phones: string[]; emails: string[]; rawResponse: Record<string, unknown> | null; createdAt: string; isMock: boolean; lead?: { id: string; companyName: string; sourceUrl: string | null; aiScore: number | null } };
const safeUrl = (value: string | null | undefined) => { try { const url = new URL(value ?? ""); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; } };
function changed() { window.dispatchEvent(new Event("lead-contact-updated")); }
export function ContactSource({ lead }: { lead: HumanLeadListItem }) {
  const evidence = contactEvidenceSummary(lead.phoneEvidence);
  return <div className="mt-1 whitespace-normal text-xs text-[var(--text-tertiary)]"><p>{lead.phone ? phoneSourceLabel(lead.phoneSource, lead.phoneEvidence) : "暂无电话"}</p>{evidence.sharedPhoneLeadCount > 0 && <p className="text-amber-600">疑似代账/共用电话（另 {evidence.sharedPhoneLeadCount} 条）</p>}{evidence.sharedPhoneCustomer && <p className="text-amber-600">该号码属于已有客户 {evidence.sharedPhoneCustomer}</p>}</div>;
}
export function ContactLookupButton({ leadId, onRefresh, allowQuery = false }: { leadId: string; onRefresh: () => unknown; allowQuery?: boolean }) {
  const [queryName, setQueryName] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function lookup() {
    setBusy(true); setMessage("反查中…");
    try {
      const response = await fetch("/api/crm/leads/" + encodeURIComponent(leadId) + "/contact-lookup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(queryName.trim() ? { queryName: queryName.trim() } : {}) });
      const data = await response.json();
      setMessage(data.error || (data.isMock ? "模拟数据，不可采用" : data.reason) || ({ FOUND: "反查成功", NEEDS_CONFIRM: "待人工确认", NOT_FOUND: "反查无果", FAILED: "反查失败" } as Record<string, string>)[data.status] || "反查完成");
      changed(); await onRefresh();
    } catch { setMessage("反查失败，请刷新状态后重试"); } finally { setBusy(false); }
  }
  return <div className="mt-2 space-y-2 whitespace-normal">{allowQuery && <input aria-label="指定查询全称" className="w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm" maxLength={100} onChange={(event) => setQueryName(event.target.value)} placeholder="指定查询全称（可选）" value={queryName} />}<button className={button} type="button" disabled={busy} onClick={() => void lookup()}>{busy ? "反查中…" : "反查"}</button>{message && <p role="status" className="text-xs">{message}</p>}</div>;
}
export function ContactLookupManager({ status, onStatus, selected, onRefresh }: { status: string; onStatus: (status: string) => void; selected: HumanLeadListItem[]; onRefresh: () => unknown }) {
  const [quota, setQuota] = useState<{ used: number; limit: number; tycConfigured: boolean; fakeSearchMode: boolean; tycMockMode: boolean } | null>(null);
  const [lookups, setLookups] = useState<Lookup[]>([]); const [page, setPage] = useState(1); const [pages, setPages] = useState(1);
  const [busy, setBusy] = useState(false); const [messages, setMessages] = useState<string[]>([]);
  const refresh = useCallback(async () => {
    try {
      const q = await fetch("/api/crm/leads/contact-lookups/quota", { cache: "no-store" }); const qData = await q.json();
      if (!q.ok) throw new Error(qData.error || "额度加载失败"); setQuota(qData);
      if (status === "NEEDS_CONFIRM") {
        const response = await fetch("/api/crm/leads/contact-lookups?status=NEEDS_CONFIRM&page=" + page, { cache: "no-store" });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "待确认列表加载失败");
        setLookups(data.items); setPages(data.pagination.totalPages);
      }
    } catch (error) { setMessages([error instanceof Error ? error.message : "核验数据加载失败"]); }
  }, [status, page]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    const onChanged = () => { void refresh(); }; window.addEventListener("lead-contact-updated", onChanged);
    return () => { clearTimeout(timer); window.removeEventListener("lead-contact-updated", onChanged); };
  }, [refresh]);
  async function batch() {
    setBusy(true); setMessages([]);
    try {
      await runContactLookups(selected.filter((lead) => !lead.phone && (!lead.contactStatus || ["PENDING_LOOKUP", "LOOKUP_FAILED"].includes(lead.contactStatus))).map((lead) => lead.id), (row, index, total) => setMessages((previous) => [...previous, index + "/" + total + "：" + row.message]));
    } catch (error) { setMessages((previous) => [...previous, error instanceof Error ? error.message : "批量反查失败"]); }
    finally { setBusy(false); changed(); await onRefresh(); }
  }
  async function decide(row: Lookup, decision: "ADOPT" | "REJECT") {
    if (!window.confirm(decision === "ADOPT" ? "确认是同一家企业，并采用此联系方式？" : "确认不是同一家企业，驳回此结果？")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/crm/leads/contact-lookups/" + encodeURIComponent(row.id) + "/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "确认失败"); setMessages([decision === "ADOPT" ? "已采用" : "已驳回"]); await refresh(); await onRefresh();
    } catch (error) { setMessages([error instanceof Error ? error.message : "确认失败"]); } finally { setBusy(false); }
  }
  return <section className={card}>
    <div className="flex flex-wrap gap-2" aria-label="联系方式核验筛选">{[["", "全部"], ["PENDING_LOOKUP", "待反查"], ["NEEDS_CONFIRM", "待人工确认"], ["LOOKUP_FAILED", "反查无果"]].map(([value, label]) => <button key={value} type="button" aria-pressed={status === value} className={button + (status === value ? " bg-[var(--brand-orange-soft)] text-[var(--brand-orange)]" : "")} onClick={() => { onStatus(value); setPage(1); }}>{label}</button>)}</div>
    {quota && <p className="text-sm">今日天眼查额度：已用 {quota.used} / 上限 {quota.limit}{!quota.tycConfigured && " · 天眼查未配置"}</p>}
    {(quota?.fakeSearchMode || quota?.tycMockMode) && <p role="alert" className="rounded bg-amber-100 p-3 text-amber-900">当前启用了{quota.fakeSearchMode ? "假搜索" : ""} {quota.tycMockMode ? "天眼查模拟" : ""}模式；模拟反查号码不可采用。</p>}
    {status === "PENDING_LOOKUP" && <button className={button} type="button" disabled={busy || !selected.length || selected.length > 20} onClick={() => void batch()}>逐条反查已选线索（最多 20 条）</button>}
    <div role="status" aria-live="polite">{messages.map((message, index) => <p className="text-sm" key={index}>{message}</p>)}</div>
    {status === "NEEDS_CONFIRM" && <div className="space-y-3">{lookups.length === 0 && <p className="text-sm">暂无待人工确认结果</p>}{lookups.map((row) => <article className={card} key={row.id}><div className="grid gap-4 md:grid-cols-2"><div><p className="text-xs text-[var(--text-tertiary)]">线索公司</p><p className="font-semibold">{row.lead?.companyName}</p><p>AI 评分：{row.lead?.aiScore ?? "未评分"}</p>{safeUrl(row.lead?.sourceUrl) && <a className="text-[var(--brand-orange)]" href={safeUrl(row.lead?.sourceUrl)!} target="_blank" rel="noreferrer">来源网页</a>}</div><div><p className="text-xs text-[var(--text-tertiary)]">天眼查企业</p><p className="font-semibold">{row.matchedName || "未返回名称"}</p><p>曾用名：{Array.isArray(row.rawResponse?.historyNames) ? row.rawResponse.historyNames.join("、") : "无"}</p><p>信用代码：{row.creditCode || "未提供"}</p><p>经营状态：{row.regStatus || "未知"}</p><p>电话：{row.phones?.join("、") || "无有效电话"}</p><p>邮箱：{row.emails?.join("、") || "无"}</p><p>注册地址：{String(row.rawResponse?.regLocation || "未提供")}</p></div></div><p className="text-amber-600">{row.reason}{row.isMock && " · 模拟数据"}</p><div className="flex gap-2"><button className={button} disabled={busy || row.isMock || !row.matchedName?.trim()} title={!row.matchedName?.trim() ? "未返回企业名称，只能驳回" : undefined} type="button" onClick={() => void decide(row, "ADOPT")}>确认是同一家，采用</button><button className={button} disabled={busy} type="button" onClick={() => void decide(row, "REJECT")}>不是同一家，驳回</button></div></article>)}<div className="flex items-center gap-3"><button className={button} disabled={page <= 1} type="button" onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page} / {Math.max(1, pages)}</span><button className={button} disabled={page >= pages} type="button" onClick={() => setPage((value) => value + 1)}>下一页</button></div></div>}
  </section>;
}
export function ContactVerificationCard({ lead, isAdmin, onRefresh }: { lead: HumanLeadDetail; isAdmin: boolean; onRefresh: () => unknown }) {
  const evidence = lead.phoneEvidence && typeof lead.phoneEvidence === "object" ? lead.phoneEvidence as Record<string, unknown> : {};
  return <section className={card}><h2 className="font-semibold">联系方式核验</h2><ContactSource lead={lead} /><p className="text-sm">核实时间：{lead.phoneVerifiedAt ? new Date(lead.phoneVerifiedAt).toLocaleString("zh-CN") : "未记录"}</p>{isAdmin && <><p className="text-sm">状态：{({ HAS_CONTACT: "已有电话", PENDING_LOOKUP: "待反查", LOOKING_UP: "反查中", NEEDS_CONFIRM: "待人工确认", LOOKUP_FAILED: "反查无果" } as Record<string, string>)[lead.contactStatus ?? ""] || "历史数据"}</p><p>天眼查企业：{String(evidence.matchedName || "未记录")} · 信用代码：{lead.creditCode || "未记录"}</p><div className="space-y-2 text-sm">{typeof evidence.excerpt === "string" && <blockquote className="whitespace-pre-wrap border-l-2 border-[var(--border)] pl-3">{evidence.excerpt}</blockquote>}{typeof evidence.queryName === "string" && <p>查询全称：{evidence.queryName}</p>}{Array.isArray(evidence.allPhones) && <p>工商电话列表：{evidence.allPhones.join("、")}</p>}{Array.isArray(evidence.allEmails) && <p>工商邮箱列表：{evidence.allEmails.join("、") || "无"}</p>}</div>{(!lead.phone && (!lead.contactStatus || ["PENDING_LOOKUP", "LOOKUP_FAILED", "LOOKING_UP"].includes(lead.contactStatus))) && <ContactLookupButton leadId={lead.id} onRefresh={onRefresh} allowQuery />}<h3 className="font-medium">反查历史</h3>{(lead.contactLookups ?? []).map((row) => <div key={row.id} className="border-l-2 border-[var(--border)] pl-3 text-sm"><p>{new Date(row.createdAt).toLocaleString("zh-CN")} · {lookupStatusLabels[row.status] || row.status}{row.isMock && "（模拟数据）"}</p><p>{row.queryName} → {row.matchedName || "未匹配"}</p><p>{row.reason}</p></div>)}</>}</section>;
}
