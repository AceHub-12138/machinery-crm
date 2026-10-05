"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { PageContainer } from "@/components/layout/page-container";
import { MotionPage } from "@/components/motion/MotionPage";

export default function KitCheckResultsPage() {
  const { data: session } = useSession();
  const canExecute = (session?.user as any)?.role === "SUPER_ADMIN";
  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [orderNo, setOrderNo] = useState("");
  const [product, setProduct] = useState("");
  const [status, setStatus] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    void fetch("/api/erp/warehouses").then((response) => response.json()).then((data) => setWarehouses(Array.isArray(data) ? data : data.items || []));
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams();
      if (orderNo) params.set("orderNo", orderNo);
      if (product) params.set("product", product);
      if (status) params.set("status", status);
      if (warehouseId) params.set("warehouseId", warehouseId);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const response = await fetch(`/api/erp/kit-check-results?${params}`);
      const data = await response.json();
      setItems(data.items || []);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [orderNo, product, status, warehouseId, from, to]);

  return <PageContainer variant="data">
    <MotionPage className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-xl font-semibold">齐套检查结果</h1><p className="mt-1 text-sm text-gray-500">每次检查均独立留痕；在途采购仅展示，不计入齐套状态。</p></div>
      {canExecute && <Link href="/erp/production-orders" className="rounded bg-gray-900 px-4 py-2 text-sm text-white">新建齐套检查</Link>}
    </div>
    <div className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-4 shadow-[var(--shadow-card)] md:grid-cols-3">
      <input value={orderNo} onChange={(event) => setOrderNo(event.target.value)} placeholder="工单编号" className="rounded border p-2 text-sm" />
      <input value={product} onChange={(event) => setProduct(event.target.value)} placeholder="产品 / 机型" className="rounded border p-2 text-sm" />
      <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="rounded border p-2 text-sm"><option value="">全部仓库</option>{warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded border p-2 text-sm"><option value="">全部齐套状态</option><option value="SUFFICIENT">齐套</option><option value="SHORTAGE">缺料</option></select>
      <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="rounded border p-2 text-sm" />
      <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="rounded border p-2 text-sm" />
    </div>
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] shadow-[var(--shadow-card)]"><table className="w-full min-w-[700px] text-sm"><thead className="sticky top-0 bg-[var(--surface-muted)] text-left text-[var(--text-secondary)]"><tr><th className="p-3">检查时间</th><th>工单</th><th>机型</th><th>仓库</th><th>结果</th><th className="text-right">缺料项</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="h-12 border-t border-[var(--border)] hover:bg-[var(--surface-hover)]"><td className="p-3">{new Date(item.createdAt).toLocaleString("zh-CN")}</td><td><Link className="text-blue-700" href={`/erp/production-orders/${item.productionOrder.id}`}>{item.productionOrder.orderNo}</Link></td><td>{item.productionOrder.productModelSnapshot} {item.productionOrder.productNameSnapshot}</td><td>{item.warehouse?.name}</td><td>{item.status === "SUFFICIENT" ? "齐套" : "缺料"}</td><td className="text-right tabular-nums">{item.shortageCount}</td></tr>)}</tbody></table></div>
    </MotionPage>
  </PageContainer>;
}
