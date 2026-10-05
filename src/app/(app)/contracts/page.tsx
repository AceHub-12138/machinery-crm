"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Plus, Search } from "lucide-react";
import { PROVINCE_OPTIONS, BUSINESS_LINES } from "@/lib/region-data";
import { PageContainer } from "@/components/layout/page-container";
import { appendDateFilters, appendSalesUserFilter, readInitialDateFilters, readInitialSalesUserFilter } from "@/modules/crm/dashboard/kpi-linkage";

const PAYMENT_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  UNPAID: { label: "未回款", color: "bg-red-50 text-red-700" },
  PARTIAL_PAID: { label: "部分回款", color: "bg-yellow-50 text-yellow-700" },
  PAID: { label: "已回款", color: "bg-green-50 text-green-700" },
};

const CONTRACT_STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "DRAFT", label: "草稿" },
  { value: "SIGNED", label: "已确认" },
  { value: "PRODUCTION", label: "生产中" },
  { value: "SHIPPED", label: "已发货" },
  { value: "COMPLETED", label: "已完成" },
  { value: "ARCHIVED", label: "已归档" },
  { value: "CANCELLED", label: "已取消" },
];

function formatMoney(amount: any) {
  if (amount === null || amount === undefined || amount === "") return "-";
  return `¥${Number(amount).toLocaleString("zh-CN")}`;
}

function contractStatusBadge(contract: any) {
  if (contract.contractStatus === "DRAFT") return { label: "草稿", color: "bg-gray-100 text-gray-700" };
  if (contract.contractStatus === "COMPLETED") return { label: "已完成", color: "bg-green-50 text-green-700" };
  if (contract.contractStatus === "ARCHIVED") return { label: "已归档", color: "bg-slate-100 text-slate-700" };
  if (contract.contractStatus === "CANCELLED") return { label: "已取消", color: "bg-red-50 text-red-600" };
  if (contract.shipments?.some((item: any) => item.shipmentStatus === "SHIPPED" || item.shipmentStatus === "PARTIAL_SHIPPED")) {
    return { label: "已发货", color: "bg-cyan-50 text-cyan-700" };
  }
  return { label: "已确认", color: "bg-blue-50 text-blue-700" };
}

function contractEquipmentLabel(contract: any) {
  const mainItems = contract.items?.filter((item: any) => item.itemType === "MAIN") || [];
  if (mainItems.length) {
    return mainItems.map((item: any) => `${item.productNameSnapshot || ""} ${item.productModelSnapshot || ""}`.trim()).join("、");
  }
  return contract.equipmentName || contract.equipmentModel || "-";
}

async function readJson(res: Response) {
  return res.json().catch(() => ({}));
}

function ContractsContent() {
  const searchParams = useSearchParams();
  const initialCreatedDates = readInitialDateFilters(searchParams, "createdStart", "createdEnd");
  const initialSalesFilter = readInitialSalesUserFilter(searchParams);
  const { data: session } = useSession();
  const [contracts, setContracts] = useState<any[]>([]);
  const [activeUsers, setActiveUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [contractStatus, setContractStatus] = useState(searchParams.get("contractStatus") || "");
  const [province, setProvince] = useState(searchParams.get("province") || "");
  const [businessLine, setBusinessLine] = useState("");
  const [salesUserId, setSalesUserId] = useState(initialSalesFilter.salesUserId);
  const [kpiSalesUserId, setKpiSalesUserId] = useState(initialSalesFilter.kpiSalesUserId);
  const [paymentStatus, setPaymentStatus] = useState("");
  const [createdStart, setCreatedStart] = useState(initialCreatedDates.start);
  const [createdEnd, setCreatedEnd] = useState(initialCreatedDates.end);
  const [signedStart, setSignedStart] = useState("");
  const [signedEnd, setSignedEnd] = useState("");
  const [overdueShipment, setOverdueShipment] = useState(searchParams.get("overdueShipment") === "1");

  const userRole = (session?.user as any)?.role;
  const [refreshTick, setRefreshTick] = useState(0);
  const [actionMsg, setActionMsg] = useState("");

  // 超级管理员：直接软删除（走系统已有的删除接口，不真删数据）
  const handleDelete = async (contract: any) => {
    if (!confirm(`确认删除合同「${contract.contractNo}」？\n该合同将被标记删除（数据仍保留，可后续恢复）。`)) return;
    setActionMsg("");
    setError("");
    const res = await fetch(`/api/contracts/${contract.id}`, { method: "DELETE" });
    const data = await readJson(res);
    if (!res.ok) {
      setError(data.error || "删除失败");
      return;
    }
    setActionMsg(`合同「${contract.contractNo}」已删除。`);
    setRefreshTick((tick) => tick + 1);
  };

  // 普通业务员/外贸：提交删除申请，等待超级管理员审批
  const handleRequestDelete = async (contract: any) => {
    const reason = window.prompt(`申请删除合同「${contract.contractNo}」。\n请填写删除原因（必填，提交后需超级管理员审批）：`);
    if (reason === null) return;
    if (!reason.trim()) {
      setError("删除原因为必填项");
      return;
    }
    setActionMsg("");
    setError("");
    const res = await fetch(`/api/contract-delete-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractId: contract.id, reason: reason.trim() }),
    });
    const data = await readJson(res);
    if (!res.ok) {
      setError(data.error || "提交申请失败");
      return;
    }
    setActionMsg(`已提交「${contract.contractNo}」的删除申请，等待超级管理员审批。`);
  };

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (contractStatus) params.set("contractStatus", contractStatus);
    if (province) params.set("province", province);
    if (businessLine) params.set("businessLine", businessLine);
    appendSalesUserFilter(params, salesUserId, kpiSalesUserId);
    if (paymentStatus) params.set("paymentStatus", paymentStatus);
    appendDateFilters(params, { start: createdStart, end: createdEnd }, "createdStart", "createdEnd");
    if (signedStart) params.set("signedStart", signedStart);
    if (signedEnd) params.set("signedEnd", signedEnd);
    if (overdueShipment) params.set("overdueShipment", "1");
    return params.toString();
  }, [search, contractStatus, province, businessLine, salesUserId, kpiSalesUserId, paymentStatus, createdStart, createdEnd, signedStart, signedEnd, overdueShipment]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetch(`/api/contracts?${query}`)
      .then(async (res) => {
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.error || "合同列表加载失败");
        return Array.isArray(data) ? data : [];
      })
      .then((data) => { if (active) setContracts(data); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
    };
  }, [query, refreshTick]);

  useEffect(() => {
    fetch("/api/users/active")
      .then((res) => res.json())
      .then((data) => setActiveUsers(Array.isArray(data) ? data : []))
      .catch(() => setActiveUsers([]));
  }, []);

  const clearFilters = () => {
    setSearch("");
    setContractStatus("");
    setProvince("");
    setBusinessLine("");
    setSalesUserId("");
    setKpiSalesUserId("");
    setPaymentStatus("");
    setCreatedStart("");
    setCreatedEnd("");
    setSignedStart("");
    setSignedEnd("");
    setOverdueShipment(false);
  };

  return (
    <PageContainer variant="data" className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">合同管理</h1>
        <Link href="/contracts/new" className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800">
          <Plus className="w-4 h-4" />
          新增合同
        </Link>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {actionMsg && <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{actionMsg}</div>}

      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="relative md:col-span-2 xl:col-span-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索合同编号、客户、联系人、产品"
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>

          <select value={contractStatus} onChange={(event) => setContractStatus(event.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
            {CONTRACT_STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>

          <select value={province} onChange={(event) => setProvince(event.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
            <option value="">全部省份</option>
            {PROVINCE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          {userRole === "SUPER_ADMIN" && (
            <select value={businessLine} onChange={(event) => setBusinessLine(event.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
              <option value="">全部业务线</option>
              {BUSINESS_LINES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          )}

          <select value={salesUserId} onChange={(event) => { setSalesUserId(event.target.value); setKpiSalesUserId(""); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
            <option value="">全部业务员</option>
            {activeUsers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>

          <select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
            <option value="">全部回款</option>
            <option value="UNPAID">未回款</option>
            <option value="PARTIAL_PAID">部分回款</option>
            <option value="PAID">已回款</option>
          </select>

          <DateInput label="创建开始" value={createdStart} onChange={setCreatedStart} />
          <DateInput label="创建结束" value={createdEnd} onChange={setCreatedEnd} />
          <DateInput label="签订开始" value={signedStart} onChange={setSignedStart} />
          <DateInput label="签订结束" value={signedEnd} onChange={setSignedEnd} />
          <label className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700">
            <input type="checkbox" checked={overdueShipment} onChange={(event) => setOverdueShipment(event.target.checked)} />
            逾期未发货
          </label>
        </div>
        <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-900">清空筛选</button>
      </div>

      <div className="hidden overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] shadow-[var(--shadow-card)] lg:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1320px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">合同编号</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">客户</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">设备</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 whitespace-nowrap w-24">业务员</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">合同金额</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">已回款</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">未回款</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 whitespace-nowrap w-24">回款状态</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 whitespace-nowrap w-24">合同状态</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 whitespace-nowrap w-28">签订日期</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 whitespace-nowrap w-24">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={11} className="text-center py-8 text-sm text-gray-500">加载中...</td></tr>
              ) : contracts.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-8 text-sm text-gray-500">暂无合同</td></tr>
              ) : (
                contracts.map((contract) => {
                  const status = contractStatusBadge(contract);
                  return (
                    <tr key={contract.id} className="h-12 hover:bg-[var(--surface-hover)]">
                      <td className="px-4 py-3">
                        <Link href={`/contracts/${contract.id}`} className="text-sm font-medium text-gray-900 hover:underline">{contract.contractNo}</Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {contract.customer?.companyName}{contract.customer?.deletedAt && <span className="ml-1 text-xs text-gray-400">已隐藏</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{contractEquipmentLabel(contract)}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{contract.salesUser?.name || "-"}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium">{formatMoney(contract.amount)}</td>
                      <td className="px-4 py-3 text-sm text-green-700 text-right">{formatMoney(contract.paidAmount)}</td>
                      <td className="px-4 py-3 text-sm text-red-600 text-right">{formatMoney(contract.unpaidAmount)}</td>
                      <td className="px-4 py-3 whitespace-nowrap"><span className={`inline-flex whitespace-nowrap text-xs px-2 py-0.5 rounded-full ${PAYMENT_STATUS_LABELS[contract.paymentStatus]?.color}`}>{PAYMENT_STATUS_LABELS[contract.paymentStatus]?.label}</span></td>
                      <td className="px-4 py-3 whitespace-nowrap"><span className={`inline-flex whitespace-nowrap text-xs px-2 py-0.5 rounded-full ${status.color}`}>{status.label}</span></td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{new Date(contract.signedDate).toLocaleDateString("zh-CN")}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {userRole === "SUPER_ADMIN" ? (
                          <button
                            onClick={() => handleDelete(contract)}
                            className="whitespace-nowrap text-xs px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                          >
                            删除
                          </button>
                        ) : (
                          <button
                            onClick={() => handleRequestDelete(contract)}
                            className="whitespace-nowrap text-xs px-2.5 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
                          >
                            申请删除
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="lg:hidden space-y-3">
        {loading ? (
          <p className="text-center py-8 text-sm text-gray-500">加载中...</p>
        ) : contracts.length === 0 ? (
          <p className="text-center py-8 text-sm text-gray-500">暂无合同</p>
        ) : (
          contracts.map((contract) => {
            const status = contractStatusBadge(contract);
            return (
              <div key={contract.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <Link href={`/contracts/${contract.id}`} className="block">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{contract.contractNo}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{contract.customer?.companyName} · {contractEquipmentLabel(contract)}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${PAYMENT_STATUS_LABELS[contract.paymentStatus]?.color}`}>{PAYMENT_STATUS_LABELS[contract.paymentStatus]?.label}</span>
                  </div>
                  <div className="flex items-center justify-between mt-3 text-xs">
                    <span className="text-gray-500">合同金额：{formatMoney(contract.amount)}</span>
                    <span className={`px-2 py-0.5 rounded-full ${status.color}`}>{status.label}</span>
                  </div>
                </Link>
                <div className="mt-3 pt-3 border-t border-gray-100 flex justify-end">
                  {userRole === "SUPER_ADMIN" ? (
                    <button onClick={() => handleDelete(contract)} className="text-xs px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">
                      删除
                    </button>
                  ) : (
                    <button onClick={() => handleRequestDelete(contract)} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
                      申请删除
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </PageContainer>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm">
      <span className="shrink-0 text-xs text-gray-500">{label}</span>
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 text-sm focus:outline-none" />
    </label>
  );
}

export default function ContractsPage() {
  return (
    <Suspense fallback={<div className="text-center py-8 text-gray-500">加载中...</div>}>
      <ContractsContent />
    </Suspense>
  );
}
