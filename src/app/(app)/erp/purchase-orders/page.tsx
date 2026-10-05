"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Eye, Plus, Search } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { SurfaceCard } from "@/components/ui/surface-card";

const statusLabel: Record<string, string> = { DRAFT: "草稿", ORDERED: "已下单", PARTIAL_RECEIVED: "部分到货", RECEIVED: "已到货", CANCELLED: "已取消" };

function money(value: unknown) { return `¥${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`; }

export default function PurchaseOrdersPage() {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;
  const canEdit = role === "SUPER_ADMIN" || role === "PURCHASE";
  const visibleStatuses = Object.entries(statusLabel).filter(([value]) =>
    role !== "WAREHOUSE" || ["ORDERED", "PARTIAL_RECEIVED", "RECEIVED"].includes(value)
  );
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  const loadOrders = async () => {
    setLoading(true);
    const params = new URLSearchParams({ pageSize: "50" });
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    const res = await fetch(`/api/erp/purchase-orders?${params.toString()}`);
    const data = await res.json();
    setOrders(data.items || []);
    setLoading(false);
  };

  useEffect(() => {
    const timer = window.setTimeout(loadOrders, 200);
    return () => window.clearTimeout(timer);
  }, [search, status]);

  return (
    <PageContainer variant="data" className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-xl font-semibold text-[var(--text-primary)]">采购订单</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">采购维护订单草稿和下单流程；仓库管理仅查看可收货订单并通过入库模块收货。</p></div>
        {canEdit && <Link href="/erp/purchase-orders/new" className={buttonVariants({ variant: "primary" })}><Plus className="h-4 w-4" />新增采购订单</Link>}
      </div>
      <SurfaceCard className="flex flex-col gap-3 p-4 sm:flex-row">
        <div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索采购单号或供应商" className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-orange)]" /></div>
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-orange)]"><option value="">全部状态</option>{visibleStatuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      </SurfaceCard>
      {loading ? <SurfaceCard className="p-5"><LoadingSkeleton lines={6} /></SurfaceCard> : orders.length === 0 ? <SurfaceCard><EmptyState title="暂无采购订单" /></SurfaceCard> : <SurfaceCard className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead className="sticky top-0 border-b border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-secondary)]"><tr><th className="px-4 py-3 text-left font-medium">采购单号</th><th className="px-4 py-3 text-left font-medium">供应商</th><th className="px-4 py-3 text-left font-medium">订单日期</th><th className="px-4 py-3 text-left font-medium">预计到货</th><th className="px-4 py-3 text-right font-medium">明细 / 金额</th><th className="px-4 py-3 text-left font-medium">状态</th><th className="sticky right-0 bg-[var(--surface-muted)] px-4 py-3 text-center font-medium">操作</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id} className="h-12 border-b border-[var(--border)] hover:bg-[var(--surface-hover)]"><td className="px-4 py-3 font-mono text-xs">{order.orderNo}</td><td className="px-4 py-3 font-medium text-[var(--text-primary)]">{order.supplierNameSnapshot}</td><td className="px-4 py-3 text-[var(--text-secondary)]">{new Date(order.orderDate).toLocaleDateString("zh-CN")}</td><td className="px-4 py-3 text-[var(--text-secondary)]">{order.expectedArrivalDate ? new Date(order.expectedArrivalDate).toLocaleDateString("zh-CN") : "-"}</td><td className="px-4 py-3 text-right tabular-nums"><span>{order.itemCount} 项</span><span className="ml-3 font-medium">{money(order.totalAmount)}</span></td><td className="px-4 py-3"><StatusBadge status={order.status} type="purchase" /></td><td className="sticky right-0 bg-[var(--surface-solid)] px-4 py-3 text-center"><Link href={`/erp/purchase-orders/${order.id}`} title="查看采购订单" className="inline-flex text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"><Eye className="h-4 w-4" /></Link></td></tr>)}</tbody></table></SurfaceCard>}
    </PageContainer>
  );
}
