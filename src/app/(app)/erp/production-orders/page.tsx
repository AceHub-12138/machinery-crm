"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Eye, Plus, Search } from "lucide-react";
import { ClipboardCheck } from "lucide-react";
import { useSession } from "next-auth/react";
import { PageContainer } from "@/components/layout/page-container";

const statusLabel: Record<string, string> = { DRAFT: "草稿", ISSUED: "待齐套检查", CHANGE_PENDING: "变更待审批", CANCELLED: "已作废" };
const statusColor: Record<string, string> = { DRAFT: "bg-gray-100 text-gray-700", ISSUED: "bg-blue-100 text-blue-700", CHANGE_PENDING: "bg-amber-100 text-amber-700", CANCELLED: "bg-red-100 text-red-700" };

export default function ProductionOrdersPage() {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;
  const canPublish = role === "SUPER_ADMIN";
  const canKitCheck = role === "SUPER_ADMIN" || role === "WAREHOUSE";
  const showContractSource = role !== "PURCHASE";
  const [orders, setOrders] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams({ pageSize: "50" });
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    const response = await fetch(`/api/erp/production-orders?${params}`);
    const data = await response.json();
    setOrders(data.items || []);
    setLoading(false);
  };
  useEffect(() => { const timer = window.setTimeout(load, 200); return () => window.clearTimeout(timer); }, [search, status]);
  const runKitCheck = async (orderId: string) => {
    const response = await fetch(`/api/erp/production-orders/${orderId}/kit-check`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) return alert(data.error || "齐套检查失败");
    await load();
  };
  return <PageContainer variant="data" className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h1 className="text-xl font-semibold text-gray-900">生产工单</h1><p className="mt-1 text-sm text-gray-500">关联合同或备货机型下达生产任务；发布时固化用料快照，可按需执行齐套检查。</p></div>
      {canPublish && <Link href="/erp/production-orders/new" className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"><Plus className="h-4 w-4" />新建生产工单</Link>}
    </div>
    <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-4 shadow-[var(--shadow-card)] sm:flex-row">
      <div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索工单号、合同号、机型" className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm" /></div>
      <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="">全部状态</option>{Object.entries(statusLabel).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
    </div>
    {loading ? <p className="py-8 text-center text-sm text-[var(--text-secondary)]">加载中...</p> : orders.length === 0 ? <p className="py-8 text-center text-sm text-[var(--text-secondary)]">暂无生产工单</p> : <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] shadow-[var(--shadow-card)]"><table className="w-full min-w-[940px] text-sm"><thead className="sticky top-0 border-b border-[var(--border)] bg-[var(--surface-muted)]"><tr><th className="px-4 py-3 text-left font-medium text-[var(--text-secondary)]">工单号</th>{showContractSource && <th className="px-4 py-3 text-left font-medium text-[var(--text-secondary)]">合同 / 来源</th>}<th className="px-4 py-3 text-left font-medium text-[var(--text-secondary)]">机型</th><th className="px-4 py-3 text-right font-medium text-[var(--text-secondary)]">数量</th><th className="px-4 py-3 text-left font-medium text-[var(--text-secondary)]">状态</th><th className="sticky right-0 bg-[var(--surface-muted)] px-4 py-3 text-center font-medium text-[var(--text-secondary)]">操作</th></tr></thead><tbody>{orders.map((order) => { const latest = order.latestKitCheckResult; const displayStatus = order.status === "ISSUED" ? order.kitCheckRequired ? "待复检" : latest?.status === "SUFFICIENT" ? "齐套" : latest?.status === "SHORTAGE" ? "缺料" : "待齐套检查" : statusLabel[order.status] || order.status; return <tr key={order.id} className="h-12 border-b border-[var(--border)] hover:bg-[var(--surface-hover)]"><td className="px-4 py-3 font-mono text-xs">{order.orderNo}</td>{showContractSource && <td className="px-4 py-3">{order.contractNoSnapshot || "备货生产"}</td>}<td className="px-4 py-3 font-medium text-[var(--text-primary)]">{order.productModelSnapshot}<span className="ml-1 text-[var(--text-secondary)]">{order.productNameSnapshot}</span></td><td className="px-4 py-3 text-right tabular-nums">{Number(order.quantity).toLocaleString()}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs ${statusColor[order.status] || "bg-gray-100 text-gray-700"}`}>{displayStatus}</span></td><td className="sticky right-0 bg-[var(--surface-solid)] px-4 py-3 text-center"><div className="inline-flex items-center gap-3"><Link href={`/erp/production-orders/${order.id}`} title="查看生产工单" className="inline-flex text-gray-500 hover:text-gray-900"><Eye className="h-4 w-4" /></Link>{canKitCheck && order.status === "ISSUED" && <button onClick={() => runKitCheck(order.id)} title="齐套检查" className="inline-flex text-gray-500 hover:text-gray-900"><ClipboardCheck className="h-4 w-4" /></button>}</div></td></tr>; })}</tbody></table></div>}
  </PageContainer>;
}
