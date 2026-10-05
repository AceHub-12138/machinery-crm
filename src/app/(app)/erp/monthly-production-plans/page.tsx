"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { PageContainer } from "@/components/layout/page-container";

const status: Record<string, string> = { DRAFT: "草稿", PENDING_APPROVAL: "待审核", APPROVED: "已审核", IN_PROGRESS: "执行中", COMPLETED: "已完成", CANCELLED: "已取消" };
const blank = () => ({ productId: "", plannedQuantity: "1", plannedStartDate: "", plannedCompletionDate: "", bomId: "", remark: "" });

export default function MonthlyPlansPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canManageSpareForecast = role === "SUPER_ADMIN" || role === "PURCHASE";
  const [plans, setPlans] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [boms, setBoms] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ planMonth: new Date().toISOString().slice(0, 7), name: "", description: "", items: [blank()] });

  const load = async () => {
    const [planResponse, productResponse, bomResponse] = await Promise.all([
      fetch("/api/erp/monthly-production-plans"),
      fetch("/api/erp/products?productType=MAIN"),
      fetch("/api/erp/boms?pageSize=200"),
    ]);
    const [planData, productData, bomData] = await Promise.all([planResponse.json(), productResponse.json(), bomResponse.json()]);
    setPlans(Array.isArray(planData) ? planData : []);
    setProducts(Array.isArray(productData) ? productData : productData.items || []);
    setBoms(Array.isArray(bomData) ? bomData : bomData.items || []);
  };

  useEffect(() => { void load().catch((reason) => setError(reason.message)); }, []);
  const update = (index: number, patch: any) => setForm({ ...form, items: form.items.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row) });

  const create = async () => {
    setError("");
    const response = await fetch("/api/erp/monthly-production-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await response.json();
    if (!response.ok) return setError(data.error || "创建失败");
    setForm({ ...form, name: "", description: "", items: [blank()] });
    await load();
  };

  const submit = async (id: string) => {
    const response = await fetch(`/api/erp/monthly-production-plans/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "PENDING_APPROVAL" }) });
    const data = await response.json();
    if (!response.ok) return setError(data.error || "提交失败");
    await load();
  };

  const approve = async (id: string) => {
    const response = await fetch(`/api/erp/monthly-production-plans/${id}/approve`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) return setError(data.error || "审核失败");
    await load();
  };

  return <PageContainer variant="data" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">月度生产计划</h1><p className="mt-1 text-sm text-gray-500">用于安排主产品的月度生产数量和日期；审核时冻结用料版本，不会自动生成采购需求。</p></div>{canManageSpareForecast && <Link href="/erp/monthly-production-plans/spare-parts-forecast" className="rounded-lg border px-3 py-2 text-sm">进入月度生产计划备件预测</Link>}</div>
    <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-4 shadow-[var(--shadow-card)]">
      <div className="grid gap-3 md:grid-cols-3"><input type="month" className="rounded border p-2 text-sm" value={form.planMonth} onChange={(event) => setForm({ ...form, planMonth: event.target.value })} /><input className="rounded border p-2 text-sm" placeholder="计划名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><input className="rounded border p-2 text-sm" placeholder="计划说明" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></div>
      {form.items.map((row, index) => <div key={index} className="mt-3 grid items-end gap-2 md:grid-cols-6"><select className="rounded border p-2 text-sm" value={row.productId} onChange={(event) => update(index, { productId: event.target.value, bomId: "" })}><option value="">设备型号</option>{products.map((product) => <option key={product.id} value={product.id}>{product.model}</option>)}</select><input type="number" min="1" className="rounded border p-2 text-sm" value={row.plannedQuantity} onChange={(event) => update(index, { plannedQuantity: event.target.value })} /><label className="text-xs font-medium text-gray-600">计划开始日期<input type="date" className="mt-1 w-full rounded border p-2 text-sm" value={row.plannedStartDate} onChange={(event) => update(index, { plannedStartDate: event.target.value })} /></label><label className="text-xs font-medium text-gray-600">计划完成日期<input type="date" className="mt-1 w-full rounded border p-2 text-sm" value={row.plannedCompletionDate} onChange={(event) => update(index, { plannedCompletionDate: event.target.value })} /></label><select className="rounded border p-2 text-sm" value={row.bomId} onChange={(event) => update(index, { bomId: event.target.value })}><option value="">有效用料版本</option>{boms.filter((bom) => bom.productId === row.productId && bom.isActive).map((bom) => <option key={bom.id} value={bom.id}>{bom.version}</option>)}</select><button type="button" disabled={form.items.length === 1} className="rounded border py-2 text-sm disabled:opacity-40" onClick={() => setForm({ ...form, items: form.items.filter((_, rowIndex) => rowIndex !== index) })}>删除</button></div>)}
      <div className="mt-3 flex gap-2"><button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => setForm({ ...form, items: [...form.items, blank()] })}>增加机型</button><button type="button" className="rounded bg-gray-900 px-4 py-2 text-sm text-white" onClick={create}>保存草稿</button></div>{error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
    <section className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] shadow-[var(--shadow-card)]"><table className="w-full min-w-[900px] text-sm"><thead className="sticky top-0 bg-[var(--surface-muted)] text-left text-gray-500"><tr><th className="p-3">计划编号</th><th>月份</th><th>名称</th><th>版本</th><th>机型数</th><th>状态</th><th>操作</th></tr></thead><tbody>{plans.map((plan) => <tr key={plan.id} className="h-12 border-t border-[var(--border)] hover:bg-[var(--surface-hover)]"><td className="p-3">{plan.planNo}</td><td>{String(plan.planMonth).slice(0, 7)}</td><td>{plan.name}</td><td>V{plan.version}</td><td className="tabular-nums text-right">{plan.items.length}</td><td>{status[plan.status]}</td><td>{plan.status === "DRAFT" && <button className="mr-2 text-blue-600" onClick={() => submit(plan.id)}>提交审核</button>}{plan.status === "PENDING_APPROVAL" && <button className="text-blue-600" onClick={() => approve(plan.id)}>审核并冻结用料</button>}</td></tr>)}</tbody></table></section>
  </PageContainer>;
}
