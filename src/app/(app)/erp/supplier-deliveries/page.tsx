"use client";

import { useCallback, useEffect, useState } from "react";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { SurfaceCard } from "@/components/ui/surface-card";

const riskLabel: Record<string, string> = { NORMAL: "正常", ATTENTION: "关注", HIGH_RISK: "高风险", OVERDUE: "已逾期" };
const sourceLabel: Record<string, string> = { PRODUCTION_ORDER: "生产工单", STOCK_REPLENISHMENT: "备货", MONTHLY_PRODUCTION_PLAN: "月度生产计划", MANUAL: "手工采购" };

type DeliveryRow = {
  id: string; orderNo: string; supplier: string; materialCodeSnapshot: string; materialNameSnapshot: string;
  quantity: string; receivedQuantity: string; remainingQuantity: number; sourceTypes: string[];
  demandSources: Array<{ id: string; allocatedQuantity: string; purchaseDemand: { sourceLabel: string } }>;
  needArrivalDate: string | null; firstPromisedDate: string | null; latestPromisedDate: string | null;
  actualShipDate: string | null; promiseHistory: unknown[]; calculatedDeliveryStatus: string;
  risk: { level: string; days: number | null; affectsProduction: boolean };
  lastFollowUp: { progress: string; followedAt: string } | null;
};

export default function SupplierDeliveriesPage() {
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [risk, setRisk] = useState("");
  const [due, setDue] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const query = new URLSearchParams();
    if (risk) query.set("risk", risk);
    if (due) query.set("due", due);
    if (sourceType) query.set("sourceType", sourceType);
    const response = await fetch(`/api/erp/supplier-deliveries?${query}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setRows(data.items || []);
  }, [due, risk, sourceType]);

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams();
    if (risk) query.set("risk", risk); if (due) query.set("due", due); if (sourceType) query.set("sourceType", sourceType);
    fetch(`/api/erp/supplier-deliveries?${query}`).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data.items as DeliveryRow[];
    }).then((data) => { if (active) setRows(data || []); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "加载失败"); });
    return () => { active = false; };
  }, [due, risk, sourceType]);

  async function submit(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "操作失败");
    await load();
  }

  async function updatePromise(row: DeliveryRow) {
    const newDate = window.prompt("供应商最新承诺日期（YYYY-MM-DD）", row.latestPromisedDate?.slice(0, 10) || "");
    if (!newDate) return;
    const feedbackReason = window.prompt("供应商反馈原因") || "采购跟进更新";
    await submit(`/api/erp/supplier-deliveries/${row.id}/promise-date`, { promisedDate: newDate, supplierReason: feedbackReason });
  }

  async function addFollowUp(row: DeliveryRow) {
    const progress = window.prompt("当前进度（如：生产中、待发货、已发货、延期）", "生产中");
    if (!progress) return;
    const remark = window.prompt("跟进备注") || "";
    await submit(`/api/erp/supplier-deliveries/${row.id}/follow-ups`, { progress, remark });
  }

  async function addBatch(row: DeliveryRow) {
    const plannedQuantity = window.prompt("本批计划到货数量");
    if (!plannedQuantity) return;
    const plannedArrivalDate = window.prompt("本批计划到货日期（YYYY-MM-DD）");
    await submit(`/api/erp/supplier-deliveries/${row.id}/batches`, { plannedQuantity, plannedArrivalDate });
  }

  return <PageContainer variant="data" className="space-y-5">
    <div><h1 className="text-2xl font-semibold text-[var(--text-primary)]">供应商交期跟踪</h1><p className="text-sm text-[var(--text-secondary)]">按采购明细跟踪承诺、发货、分批到货及多来源数量分摊；实际到货数量以已确认入库单为准。</p></div>
    <SurfaceCard className="flex flex-wrap gap-2 p-4">
      <select className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] p-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-orange)]" value={risk} onChange={(event) => setRisk(event.target.value)}><option value="">全部风险</option>{Object.entries(riskLabel).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
      <select className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] p-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-orange)]" value={due} onChange={(event) => setDue(event.target.value)}><option value="">全部交期</option><option value="today">今日到期</option><option value="3">3天内到期</option><option value="7">7天内到期</option><option value="overdue">已逾期</option></select>
      <select className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] p-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-orange)]" value={sourceType} onChange={(event) => setSourceType(event.target.value)}><option value="">全部来源</option>{Object.entries(sourceLabel).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
      <Button onClick={() => load().catch((reason) => setError(reason.message))} variant="ghost" size="compact">刷新</Button>
    </SurfaceCard>
    {error && <SurfaceCard className="p-1"><ErrorState message={error} /></SurfaceCard>}
    <SurfaceCard className="overflow-x-auto"><table className="w-full min-w-[1700px] text-sm"><thead className="bg-[var(--surface-muted)] text-left text-[var(--text-secondary)]"><tr><th className="p-3">采购单</th><th>供应商</th><th>物料</th><th>采购/到货/未到</th><th>来源</th><th>需求到货</th><th>首次承诺</th><th>最新承诺</th><th>实际发货</th><th>交期天数</th><th>风险</th><th>影响生产</th><th>最近跟进</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.map((row) => <tr className="h-12 border-t border-[var(--border)] hover:bg-[var(--surface-hover)]" key={row.id}><td className="p-3">{row.orderNo}</td><td>{row.supplier}</td><td>{row.materialCodeSnapshot} {row.materialNameSnapshot}</td><td className="tabular-nums text-right">{Number(row.quantity)} / {Number(row.receivedQuantity)} / {row.remainingQuantity}</td><td>{row.sourceTypes.length ? row.sourceTypes.map((type) => sourceLabel[type] || type).join("、") : "手工采购"}<details><summary className="cursor-pointer text-[var(--info)]">查看分摊</summary>{row.demandSources.map((source) => <div key={source.id}>{source.purchaseDemand.sourceLabel}: {Number(source.allocatedQuantity)}</div>)}</details></td><td>{row.needArrivalDate?.slice(0, 10) || "—"}</td><td>{row.firstPromisedDate?.slice(0, 10) || "—"}</td><td>{row.latestPromisedDate?.slice(0, 10) || "—"}<div className="text-xs text-[var(--text-tertiary)]">变更 {Math.max(row.promiseHistory.length - 1, 0)} 次</div></td><td>{row.actualShipDate?.slice(0, 10) || "—"}</td><td className="tabular-nums text-right">{row.risk.days ?? "—"}</td><td><StatusBadge status={riskLabel[row.risk.level] || row.risk.level} /></td><td>{row.risk.affectsProduction ? "可能影响" : "否"}</td><td>{row.lastFollowUp ? `${row.lastFollowUp.progress} ${row.lastFollowUp.followedAt.slice(0, 10)}` : "未跟进"}</td><td><StatusBadge status={row.calculatedDeliveryStatus} type="purchase" /></td><td><div className="flex min-w-max gap-1"><Button className="whitespace-nowrap" variant="ghost" size="compact" onClick={() => updatePromise(row).catch((reason) => setError(reason.message))}>更新承诺</Button><Button className="whitespace-nowrap" variant="ghost" size="compact" onClick={() => addFollowUp(row).catch((reason) => setError(reason.message))}>新增跟进</Button><Button className="whitespace-nowrap" variant="ghost" size="compact" onClick={() => addBatch(row).catch((reason) => setError(reason.message))}>计划批次</Button></div></td></tr>)}</tbody></table></SurfaceCard>
  </PageContainer>;
}
