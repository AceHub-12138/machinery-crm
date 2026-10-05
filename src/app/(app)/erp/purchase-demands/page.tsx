"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MaterialCombobox } from "@/components/erp/material-combobox";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { SurfaceCard } from "@/components/ui/surface-card";

const sourceLabels: Record<string, string> = { PRODUCTION_ORDER: "生产工单", STOCK_REPLENISHMENT: "备货", MONTHLY_PRODUCTION_PLAN: "月度计划/备件预测", MANUAL: "手工采购" };
const statusLabels: Record<string, string> = { DRAFT: "草稿", SUBMITTED: "已提交", APPROVED: "已审核", PARTIALLY_CONVERTED: "部分转采购单", CONVERTED: "已转采购单", CANCELLED: "已取消" };

export default function PurchaseDemandsPage() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [converting, setConverting] = useState(false);
  const [form, setForm] = useState({ materialId: "", quantity: "", needByDate: "", stockPurpose: "", replenishmentReason: "安全库存补充" });

  const load = async () => {
    const [demandResponse, materialResponse, supplierResponse] = await Promise.all([fetch("/api/erp/purchase-demands"), fetch("/api/erp/materials"), fetch("/api/erp/suppliers")]);
    const [demandData, materialData, supplierData] = await Promise.all([demandResponse.json(), materialResponse.json(), supplierResponse.json()]);
    setItems(Array.isArray(demandData) ? demandData : []);
    setMaterials(Array.isArray(materialData) ? materialData : materialData.items || []);
    setSuppliers(Array.isArray(supplierData) ? supplierData : supplierData.items || []);
  };

  useEffect(() => { void load().catch((reason) => setError(reason.message)); }, []);

  const create = async () => {
    setError(""); setMessage("");
    const response = await fetch("/api/erp/purchase-demands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, sourceType: "STOCK_REPLENISHMENT" }) });
    const data = await response.json();
    if (!response.ok) return setError(data.error || "保存失败");
    setForm({ ...form, materialId: "", quantity: "", stockPurpose: "" });
    setMessage(`采购需求 ${data.demandNo} 已保存。`);
    await load();
  };

  const selectable = useMemo(() => items.filter((item) => Number(item.suggestedQuantity) - Number(item.convertedQuantity || 0) > 0), [items]);
  const toggle = (item: any, checked: boolean) => {
    const remaining = Math.max(Number(item.suggestedQuantity) - Number(item.convertedQuantity || 0), 0);
    setSelected((current) => {
      const next = { ...current };
      if (checked) next[item.id] = String(remaining);
      else delete next[item.id];
      return next;
    });
  };

  const convert = async () => {
    const allocations = Object.entries(selected).map(([purchaseDemandId, quantity]) => ({ purchaseDemandId, quantity }));
    if (!supplierId || allocations.length === 0) return setError("请选择供应商和至少一项采购需求");
    setConverting(true); setError(""); setMessage("");
    const response = await fetch("/api/erp/purchase-demands/convert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ supplierId, allocations }) });
    const data = await response.json();
    setConverting(false);
    if (!response.ok) return setError(data.error || "生成采购订单草稿失败");
    setSelected({}); setSupplierId("");
    await load();
    if (window.confirm(`已生成采购订单草稿 ${data.orderNo}。是否立即查看？`)) router.push(`/erp/purchase-orders/${data.id}`);
  };

  return <PageContainer variant="data" className="space-y-5">
    <div><h1 className="text-2xl font-semibold text-[var(--text-primary)]">采购需求</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">生产工单、月度备件预测和备货需求统一汇总；选择需求和供应商后，才生成采购订单草稿。</p></div>
    <SurfaceCard as="section" className="p-4"><h2 className="font-medium text-[var(--text-primary)]">新增备货需求</h2><div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,2fr)_minmax(120px,0.7fr)_minmax(150px,0.9fr)_minmax(160px,1fr)_minmax(190px,1.1fr)]"><div className="md:col-span-2 xl:col-span-1"><MaterialCombobox materials={materials} value={form.materialId} onChange={(materialId) => setForm({ ...form, materialId })} /></div><input className="min-w-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] p-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-orange)]" type="number" min="0.01" placeholder="备货数量" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /><input className="min-w-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] p-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-orange)]" type="date" value={form.needByDate} onChange={(event) => setForm({ ...form, needByDate: event.target.value })} /><input className="min-w-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] p-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-orange)]" placeholder="备货用途" value={form.stockPurpose} onChange={(event) => setForm({ ...form, stockPurpose: event.target.value })} /><select className="min-w-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] p-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-orange)]" value={form.replenishmentReason} onChange={(event) => setForm({ ...form, replenishmentReason: event.target.value })}>{["安全库存补充", "常用物料备货", "长周期物料提前采购", "价格上涨前备货", "供应商停产风险", "售后备件", "临时备货", "其他"].map((value) => <option key={value}>{value}</option>)}</select></div><Button onClick={create} className="mt-3">保存备货需求</Button></SurfaceCard>
    <SurfaceCard as="section" className="p-4"><div className="flex flex-wrap items-end gap-3"><label className="min-w-[260px] flex-1 text-sm font-medium text-[var(--text-primary)]">本次采购供应商<select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-orange)]"><option value="">请选择供应商</option>{suppliers.filter((supplier) => supplier.isActive !== false).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code ? `${supplier.code} - ` : ""}{supplier.name}</option>)}</select></label><Button onClick={convert} disabled={converting || !supplierId || Object.keys(selected).length === 0}>{converting ? "生成中..." : `生成采购订单草稿（${Object.keys(selected).length}）`}</Button></div><p className="mt-2 text-xs text-[var(--text-secondary)]">可合并选择多项需求；生成后可在采购订单草稿中调整单价和数量，不会自动下单。</p></SurfaceCard>
    {error && <SurfaceCard className="p-1"><ErrorState message={error} /></SurfaceCard>}{message && <p className="rounded-[var(--radius-md)] bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">{message}</p>}
    <SurfaceCard as="section" className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm"><thead className="bg-[var(--surface-muted)] text-left text-[var(--text-secondary)]"><tr><th className="p-3">选择</th><th>需求号</th><th>来源</th><th>物料</th><th>新增需求</th><th>建议采购</th><th>剩余可转</th><th>本次转采购单</th><th>需要日期</th><th>状态</th><th>用途/原因</th></tr></thead><tbody>{items.map((item) => { const remaining = Math.max(Number(item.suggestedQuantity) - Number(item.convertedQuantity || 0), 0); return <tr className="border-t border-[var(--border)] hover:bg-[var(--surface-hover)]" key={item.id}><td className="p-3"><input type="checkbox" disabled={remaining <= 0} checked={selected[item.id] !== undefined} onChange={(event) => toggle(item, event.target.checked)} /></td><td>{item.demandNo}</td><td><span className="block">{sourceLabels[item.sourceType] || item.sourceType}</span><span className="text-xs text-[var(--text-tertiary)]">{item.sourceLabel}</span></td><td>{item.material?.code} {item.material?.name}</td><td>{Number(item.requestedQuantity)} {item.material?.unit}</td><td>{Number(item.suggestedQuantity)}</td><td>{remaining}</td><td>{selected[item.id] !== undefined ? <input type="number" min="0.01" max={remaining} step="0.01" value={selected[item.id]} onChange={(event) => setSelected({ ...selected, [item.id]: event.target.value })} className="w-24 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-solid)] px-2 py-1 text-right text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-orange)]" /> : "—"}</td><td>{String(item.needByDate).slice(0, 10)}</td><td><StatusBadge status={statusLabels[item.status] || item.status} type="purchase" /></td><td>{item.stockPurpose || item.replenishmentReason || "—"}</td></tr>; })}</tbody></table>{selectable.length === 0 && <EmptyState title="暂无待转换的采购需求" />}</SurfaceCard>
  </PageContainer>;
}
