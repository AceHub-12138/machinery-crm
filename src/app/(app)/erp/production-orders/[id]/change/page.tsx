"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function ProductionOrderChangePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<any>(null);
  const [refs, setRefs] = useState<any>({ products: [], boms: [], warehouses: [], users: [] });
  const [reason, setReason] = useState("");
  const [form, setForm] = useState<any>(null);

  useEffect(() => {
    void (async () => {
      const get = async (url: string) => { const response = await fetch(url); return response.json(); };
      const [data, products, boms, warehouses, users] = await Promise.all([
        get(`/api/erp/production-orders/${id}`),
        get("/api/erp/products?productType=MAIN"),
        get("/api/erp/boms?pageSize=200"),
        get("/api/erp/warehouses"),
        get("/api/erp/production-users"),
      ]);
      setOrder(data);
      setRefs({ products: Array.isArray(products) ? products : [], boms: boms.items || [], warehouses: Array.isArray(warehouses) ? warehouses : warehouses.items || [], users: Array.isArray(users) ? users : users.items || [] });
      setForm({
        contractId: data.contractId || "",
        contractItemId: data.contractItemId || "",
        productId: data.productId,
        quantity: String(data.quantity),
        bomId: data.bomId,
        warehouseId: data.warehouseId,
        plannedDate: data.plannedDate ? new Date(data.plannedDate).toISOString().slice(0, 10) : "",
        responsibleId: data.responsibleId || "",
        specialRequirements: data.configuration?.specialRequirements || "",
        remark: data.remark || "",
      });
    })();
  }, [id]);

  const submit = async () => {
    const response = await fetch(`/api/erp/production-orders/${id}/change-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, reason }),
    });
    const data = await response.json();
    if (!response.ok) return alert(data.error || "提交失败");
    alert("变更申请已提交，等待管理员审批。");
    router.replace(`/erp/production-orders/${id}`);
  };

  if (!order || !form) return <p className="py-8 text-center text-sm text-gray-500">加载中...</p>;
  const field = (key: string, value: string) => setForm({ ...form, [key]: value });
  const boms = refs.boms.filter((item: any) => item.productId === form.productId && item.isActive !== false);

  return <div className="mx-auto max-w-3xl space-y-4">
    <Link href={`/erp/production-orders/${id}`} className="text-sm text-gray-600">返回工单</Link>
    <div className="rounded-xl border bg-white p-6">
      <h1 className="text-xl font-semibold">申请变更工单 {order.orderNo}</h1>
      <p className="mt-1 text-sm text-gray-500">原工单不会被直接修改；审批通过后生成新版本、重建快照并自动重新齐套检查。</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm">关联合同（锁定）<input readOnly value={order.contractNoSnapshot || "备货生产"} className="mt-1 w-full rounded border bg-gray-50 p-2" /></label>
        <label className="text-sm">机型<select value={form.productId} onChange={(event) => field("productId", event.target.value)} className="mt-1 w-full rounded border p-2">{refs.products.map((item: any) => <option key={item.id} value={item.id}>{item.model}</option>)}</select></label>
        <label className="text-sm">数量<input type="number" min="0.01" step="0.01" value={form.quantity} onChange={(event) => field("quantity", event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
        <label className="text-sm">整机用料清单<select value={form.bomId} onChange={(event) => field("bomId", event.target.value)} className="mt-1 w-full rounded border p-2">{boms.map((item: any) => <option key={item.id} value={item.id}>{item.version}</option>)}</select></label>
        <label className="text-sm">仓库<select value={form.warehouseId} onChange={(event) => field("warehouseId", event.target.value)} className="mt-1 w-full rounded border p-2">{refs.warehouses.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-sm">生产负责人<select value={form.responsibleId} onChange={(event) => field("responsibleId", event.target.value)} className="mt-1 w-full rounded border p-2"><option value="">暂不指定</option>{refs.users.map((item: any) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>
        <label className="text-sm">合同交货日期（只读）<input readOnly value={order.contractMeta?.estimatedShipmentDate ? new Date(order.contractMeta.estimatedShipmentDate).toISOString().slice(0, 10) : "未填写"} className="mt-1 w-full rounded border bg-gray-50 p-2" /></label>
        <label className="text-sm">计划完工日期<input type="date" value={form.plannedDate} onChange={(event) => field("plannedDate", event.target.value)} className="mt-1 w-full rounded border p-2" /><span className="mt-1 block text-xs text-gray-500">晚于合同交货日期的延期只能通过本变更审批生效。</span></label>
        <label className="text-sm sm:col-span-2">特殊配置 / 生产要求<textarea value={form.specialRequirements} onChange={(event) => field("specialRequirements", event.target.value)} className="mt-1 w-full rounded border p-2" rows={3} /></label>
        <label className="text-sm sm:col-span-2">备注<textarea value={form.remark} onChange={(event) => field("remark", event.target.value)} className="mt-1 w-full rounded border p-2" rows={2} /></label>
        <label className="text-sm sm:col-span-2">变更原因（必填）<textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded border p-2" rows={3} /></label>
      </div>
      <button onClick={submit} disabled={!reason.trim()} className="mt-5 rounded bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">提交变更申请</button>
    </div>
  </div>;
}
