"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { ChevronLeft, ChevronRight, Edit2, Phone, Plus, Search, Trash2 } from "lucide-react";
import { CUSTOMER_LEVELS, CUSTOMER_STATUS_LABELS, INTEREST_TAGS } from "@/lib/constants";
import { PROVINCE_OPTIONS, BUSINESS_LINES } from "@/lib/region-data";
import { PageContainer } from "@/components/layout/page-container";
import { appendDateFilters, appendSalesUserFilter, readInitialDateFilters, readInitialSalesUserFilter } from "@/modules/crm/dashboard/kpi-linkage";

function formatMoney(value: number) {
  return value > 0 ? `¥${value.toLocaleString("zh-CN")}` : "-";
}

async function readJson(res: Response) {
  return res.json().catch(() => ({}));
}

function CustomersContent() {
  const searchParams = useSearchParams();
  const initialCreatedDates = readInitialDateFilters(searchParams, "createdStart", "createdEnd");
  const initialSalesFilter = readInitialSalesUserFilter(searchParams, "assignedUserId");
  const { data: session } = useSession();
  const [customers, setCustomers] = useState<any[]>([]);
  const [activeUsers, setActiveUsers] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [province, setProvince] = useState(searchParams.get("province") || "");
  const [businessLine, setBusinessLine] = useState("");
  const [status, setStatus] = useState(searchParams.get("status") || "");
  const [level, setLevel] = useState("");
  const [tag, setTag] = useState("");
  const [assignedUserId, setAssignedUserId] = useState(initialSalesFilter.salesUserId);
  const [kpiSalesUserId, setKpiSalesUserId] = useState(initialSalesFilter.kpiSalesUserId);
  const [createdStart, setCreatedStart] = useState(initialCreatedDates.start);
  const [createdEnd, setCreatedEnd] = useState(initialCreatedDates.end);
  const [page, setPage] = useState(1);

  const userRole = (session?.user as any)?.role;
  const currentUserId = (session?.user as any)?.id;

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    params.set("page", page.toString());
    if (search) params.set("search", search);
    if (province) params.set("province", province);
    if (businessLine) params.set("businessLine", businessLine);
    if (status) params.set("status", status);
    if (level) params.set("level", level);
    if (tag) params.set("tag", tag);
    appendSalesUserFilter(params, assignedUserId, kpiSalesUserId, "assignedUserId");
    appendDateFilters(params, { start: createdStart, end: createdEnd }, "createdStart", "createdEnd");

    try {
      const res = await fetch(`/api/customers?${params.toString()}`);
      const data = await readJson(res);
      if (!res.ok) {
        setError(data.error || "客户列表加载失败");
        setCustomers([]);
        return;
      }
      setCustomers(data.customers || []);
      setPagination(data.pagination || {});
    } catch {
      setError("客户列表加载失败");
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, [page, search, province, businessLine, status, level, tag, assignedUserId, kpiSalesUserId, createdStart, createdEnd]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  useEffect(() => {
    fetch("/api/users/active")
      .then((res) => res.json())
      .then((data) => setActiveUsers(Array.isArray(data) ? data : []))
      .catch(() => setActiveUsers([]));
  }, []);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    fetchCustomers();
  };

  const businessCount = (customer: any) => {
    const count = customer._count || {};
    return (count.contracts || 0) + (count.customerQuotes || 0) + (count.followRecords || 0);
  };

  const canDelete = (customer: any) => {
    return userRole === "SUPER_ADMIN" || customer.assignedUser?.id === currentUserId;
  };

  const deleteCustomer = async (customer: any) => {
    const count = businessCount(customer);
    const message = count > 0
      ? "该客户已有业务记录，删除后将从客户列表隐藏，但历史合同、报价、发货和跟进记录仍会保留。"
      : `确认删除客户“${customer.companyName}”吗？删除后将从客户列表隐藏。`;
    if (!window.confirm(message)) return;

    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/customers/${customer.id}`, { method: "DELETE" });
      const data = await readJson(res);
      if (!res.ok) {
        setError(data.error || "删除客户失败");
        return;
      }
      setNotice(data.message || "客户已删除");
      fetchCustomers();
    } catch {
      setError("删除客户失败");
    }
  };

  return (
    <PageContainer variant="data" className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">客户管理</h1>
        <Link href="/customers/new" className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
          <Plus className="w-4 h-4" />
          新增客户
        </Link>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{notice}</div>}

      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-4 shadow-[var(--shadow-card)]">
        <form onSubmit={handleSearch} className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[220px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索公司名称、联系人、电话、邮箱"
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
            </div>
          </div>

          <select value={province} onChange={(event) => { setProvince(event.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
            <option value="">全部省份</option>
            {PROVINCE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>

          {userRole === "SUPER_ADMIN" && (
            <select value={businessLine} onChange={(event) => { setBusinessLine(event.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
              <option value="">全部业务线</option>
              {BUSINESS_LINES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          )}

          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
            <option value="">全部状态</option>
            {Object.entries(CUSTOMER_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>

          <select value={level} onChange={(event) => { setLevel(event.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
            <option value="">全部等级</option>
            {CUSTOMER_LEVELS.map((item) => <option key={item} value={item}>{item}级</option>)}
          </select>

          <select value={assignedUserId} onChange={(event) => { setAssignedUserId(event.target.value); setKpiSalesUserId(""); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
            <option value="">全部业务员</option>
            {activeUsers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>

          <select value={tag} onChange={(event) => { setTag(event.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
            <option value="">全部标签</option>
            {INTEREST_TAGS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            创建开始日期
            <input type="date" value={createdStart} onChange={(event) => { setCreatedStart(event.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            创建结束日期
            <input type="date" value={createdEnd} onChange={(event) => { setCreatedEnd(event.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </label>
        </form>
      </div>

      <div className="hidden overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] shadow-[var(--shadow-card)] lg:block">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">公司名称</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">联系人</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">区域</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">负责人</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">状态</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">成交</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">合同金额</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">回款</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={9} className="text-center py-8 text-sm text-gray-500">加载中...</td></tr>
            ) : customers.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-8 text-sm text-gray-500">暂无客户数据</td></tr>
            ) : (
              customers.map((customer) => {
                const totalAmount = customer.contracts?.reduce((sum: number, contract: any) => sum + Number(contract.amount), 0) || 0;
                const totalPaid = customer.contracts?.reduce((sum: number, contract: any) => sum + Number(contract.paidAmount), 0) || 0;
                const isWon = customer.status === "WON" || customer.contracts?.some((contract: any) => contract.contractStatus === "SIGNED");
                const payStatus = totalPaid >= totalAmount && totalAmount > 0 ? "已回款" : totalPaid > 0 ? "部分回款" : totalAmount > 0 ? "未回款" : "-";
                const payColor = payStatus === "已回款" ? "bg-green-50 text-green-700" : payStatus === "部分回款" ? "bg-yellow-50 text-yellow-700" : payStatus === "未回款" ? "bg-red-50 text-red-700" : "bg-gray-50 text-gray-500";
                return (
                  <tr key={customer.id} className="h-12 hover:bg-[var(--surface-hover)] transition-colors">
                    <td className="px-4 py-3"><Link href={`/customers/${customer.id}`} className="text-sm font-medium text-gray-900 hover:underline">{customer.companyName}</Link></td>
                    <td className="px-4 py-3 text-sm text-gray-600">{customer.contactName}</td>
                    <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{customer.province || customer.businessLine}</span></td>
                    <td className="px-4 py-3 text-sm text-gray-600">{customer.assignedUser?.name || "-"}</td>
                    <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{CUSTOMER_STATUS_LABELS[customer.status]}</span></td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${isWon ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{isWon ? "已成交" : "未成交"}</span></td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">{formatMoney(totalAmount)}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${payColor}`}>{payStatus}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Link href={`/customers/${customer.id}/edit`} className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"><Edit2 className="w-3.5 h-3.5" />编辑</Link>
                        {canDelete(customer) && (
                          <button onClick={() => deleteCustomer(customer)} className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700"><Trash2 className="w-3.5 h-3.5" />删除</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="lg:hidden space-y-3">
        {loading ? (
          <p className="text-center py-8 text-sm text-gray-500">加载中...</p>
        ) : customers.length === 0 ? (
          <p className="text-center py-8 text-sm text-gray-500">暂无客户数据</p>
        ) : (
          customers.map((customer) => {
            const isWon = customer.status === "WON" || customer.contracts?.some((contract: any) => contract.contractStatus === "SIGNED");
            const totalPaid = customer.contracts?.reduce((sum: number, contract: any) => sum + Number(contract.paidAmount), 0) || 0;
            const totalAmount = customer.contracts?.reduce((sum: number, contract: any) => sum + Number(contract.amount), 0) || 0;
            const payLabel = totalPaid >= totalAmount && totalAmount > 0 ? "已回款" : totalPaid > 0 ? "部分回款" : totalAmount > 0 ? "未回款" : "";
            return (
              <div key={customer.id} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link href={`/customers/${customer.id}`} className="text-sm font-medium text-gray-900 hover:underline">{customer.companyName}</Link>
                    <p className="text-xs text-gray-500 mt-0.5">{customer.contactName} · {customer.province || customer.businessLine}</p>
                  </div>
                  <div className="flex gap-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${isWon ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{isWon ? "已成交" : "未成交"}</span>
                    {payLabel && <span className={`text-xs px-2 py-0.5 rounded-full ${payLabel === "已回款" ? "bg-green-50 text-green-700" : payLabel === "部分回款" ? "bg-yellow-50 text-yellow-700" : "bg-red-50 text-red-700"}`}>{payLabel}</span>}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-gray-500">{CUSTOMER_STATUS_LABELS[customer.status]} · {customer.assignedUser?.name || "未分配"}</span>
                  <div className="flex items-center gap-2">
                    {customer.phone && <a href={`tel:${customer.phone}`} className="p-2 text-gray-400 hover:text-gray-600"><Phone className="w-4 h-4" /></a>}
                    <Link href={`/customers/${customer.id}/edit`} className="p-2 text-gray-400 hover:text-gray-700"><Edit2 className="w-4 h-4" /></Link>
                    {canDelete(customer) && <button onClick={() => deleteCustomer(customer)} className="p-2 text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-500">共 {pagination.total} 条，第 {pagination.page}/{pagination.totalPages} 页</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="p-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => setPage(Math.min(pagination.totalPages, page + 1))} disabled={page >= pagination.totalPages} className="p-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

export default function CustomersPage() {
  return (
    <Suspense fallback={<div className="text-center py-8 text-gray-500">加载中...</div>}>
      <CustomersContent />
    </Suspense>
  );
}
