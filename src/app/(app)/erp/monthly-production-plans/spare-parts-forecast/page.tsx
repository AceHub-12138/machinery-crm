"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Plus, Trash2 } from "lucide-react";
import { MaterialCombobox } from "@/components/erp/material-combobox";

type ForecastLine = { materialId: string; quantity: string; needByDate: string };
const blankLine = (): ForecastLine => ({ materialId: "", quantity: "1", needByDate: "" });

export default function MonthlySparePartsForecastPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canManage = role === "SUPER_ADMIN" || role === "PURCHASE";
  const [materials, setMaterials] = useState<any[]>([]);
  const [demands, setDemands] = useState<any[]>([]);
  const [forecastMonth, setForecastMonth] = useState(new Date().toISOString().slice(0, 7));
  const [remark, setRemark] = useState("");
  const [items, setItems] = useState<ForecastLine[]>([blankLine()]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());

  const load = async () => {
    const [materialResponse, demandResponse] = await Promise.all([
      fetch("/api/erp/materials"),
      fetch("/api/erp/purchase-demands?sourceType=MONTHLY_PRODUCTION_PLAN&scope=spareForecast"),
    ]);
    const [materialData, demandData] = await Promise.all([materialResponse.json(), demandResponse.json()]);
    setMaterials(Array.isArray(materialData) ? materialData : materialData.items || []);
    setDemands(Array.isArray(demandData) ? demandData : []);
  };

  useEffect(() => {
    if (canManage) void load().catch((reason) => setError(reason.message));
  }, [canManage]);

  const updateLine = (index: number, patch: Partial<ForecastLine>) => {
    setItems((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  };

  const create = async () => {
    setSaving(true); setError(""); setMessage("");
    const response = await fetch("/api/erp/monthly-spare-parts-forecasts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forecastMonth, remark, items, requestKey }),
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) return setError(data.error || "保存失败");
    setMessage(`已生成 ${data.created?.length || 0} 项采购需求${data.skipped?.length ? `，${data.skipped.length} 项因库存或在途已满足而未生成` : ""}。`);
    setItems([blankLine()]); setRemark(""); setRequestKey(crypto.randomUUID());
    await load();
  };

  if (status === "loading") return <p className="py-8 text-center text-sm text-gray-500">正在校验权限...</p>;
  if (!canManage) return <div className="rounded-xl border bg-white p-6"><h1 className="text-xl font-semibold">月度生产计划备件预测</h1><p className="mt-2 text-sm text-red-600">当前账号没有维护备件预测和生成采购需求的权限。</p><Link href="/erp/monthly-production-plans" className="mt-4 inline-block text-sm text-blue-600 hover:underline">返回月度生产计划</Link></div>;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">月度生产计划备件预测</h1><p className="mt-1 text-sm text-gray-500">按月预估售后或常用备件需求，保存后进入采购需求，不会直接生成采购订单。</p></div>
      <Link href="/erp/monthly-production-plans" className="rounded-lg border px-3 py-2 text-sm text-gray-700">返回月度生产计划</Link>
    </div>
    <section className="rounded-xl border bg-white p-4">
      <div className="grid gap-3 md:grid-cols-2"><label className="text-sm">预测月份<input type="month" value={forecastMonth} onChange={(event) => setForecastMonth(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label className="text-sm">预测说明<input value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="例如：售后常用备件" className="mt-1 w-full rounded-lg border px-3 py-2" /></label></div>
      <div className="mt-4 space-y-3">
        {items.map((line, index) => <div key={index} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_140px_170px_40px]">
          <MaterialCombobox materials={materials} value={line.materialId} onChange={(materialId) => updateLine(index, { materialId })} />
          <input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} placeholder="预测数量" className="rounded-lg border px-3 py-2 text-sm" />
          <input type="date" value={line.needByDate} onChange={(event) => updateLine(index, { needByDate: event.target.value })} className="rounded-lg border px-3 py-2 text-sm" />
          <button type="button" title="删除" disabled={items.length === 1} onClick={() => setItems(items.filter((_, lineIndex) => lineIndex !== index))} className="text-gray-400 hover:text-red-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
        </div>)}
      </div>
      <div className="mt-3 flex flex-wrap justify-between gap-2"><button type="button" onClick={() => setItems([...items, blankLine()])} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm"><Plus className="h-4 w-4" />增加备件</button><button type="button" onClick={create} disabled={saving} className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? "保存中..." : "生成采购需求"}</button></div>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}{message && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{message} <Link href="/erp/purchase-demands" className="underline">查看采购需求</Link></p>}
    </section>
    <section className="overflow-auto rounded-xl border bg-white"><table className="w-full min-w-[900px] text-sm"><thead className="bg-gray-50 text-left text-gray-500"><tr><th className="p-3">需求号</th><th>预测来源</th><th>物料</th><th>预测数量</th><th>建议采购</th><th>需要日期</th><th>状态</th></tr></thead><tbody>{demands.map((demand) => <tr key={demand.id} className="border-t"><td className="p-3">{demand.demandNo}</td><td>{demand.sourceLabel}</td><td>{demand.material?.code} {demand.material?.name}</td><td>{Number(demand.requestedQuantity)} {demand.material?.unit}</td><td>{Number(demand.suggestedQuantity)}</td><td>{String(demand.needByDate).slice(0, 10)}</td><td>{demand.status}</td></tr>)}</tbody></table>{demands.length === 0 && <p className="p-6 text-center text-sm text-gray-500">暂无月度备件预测</p>}</section>
  </div>;
}
