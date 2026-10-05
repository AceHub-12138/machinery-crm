"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "待审批",
  APPROVED: "已通过",
  REJECTED: "已拒绝",
  USED: "已使用",
};

export default function ContractUnlockRequestsPage() {
  const { data: session } = useSession();
  const [requests, setRequests] = useState<any[]>([]);
  const [status, setStatus] = useState("");
  const [remark, setRemark] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const userRole = (session?.user as any)?.role;

  const fetchRequests = () => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    fetch(`/api/contract-unlock-requests?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => Array.isArray(data) ? setRequests(data) : setError(data.error || "读取审批记录失败"));
  };

  useEffect(() => {
    if (userRole === "SUPER_ADMIN") fetchRequests();
  }, [status, userRole]);

  const handleApprove = async (id: string) => {
    setError("");
    const res = await fetch(`/api/contract-unlock-requests/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalRemark: remark[id] || "" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "审批失败");
      return;
    }
    fetchRequests();
  };

  const handleReject = async (id: string) => {
    setError("");
    const res = await fetch(`/api/contract-unlock-requests/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalRemark: remark[id] || "" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "拒绝失败");
      return;
    }
    fetchRequests();
  };

  if (userRole && userRole !== "SUPER_ADMIN") {
    return <p className="text-center py-8 text-red-600">无权查看合同审批</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">合同修改审批</h1>
        <select value={status} onChange={(event) => setStatus(event.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="">全部状态</option>
          <option value="PENDING">待审批</option>
          <option value="APPROVED">已通过</option>
          <option value="REJECTED">已拒绝</option>
          <option value="USED">已使用</option>
        </select>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {requests.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">暂无审批记录</p>
        ) : requests.map((item) => (
          <div key={item.id} className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Link href={`/contracts/${item.contractId}`} className="text-sm font-semibold text-gray-900 hover:underline">
                  {item.contract?.contractNo}
                </Link>
                <p className="text-xs text-gray-500">{item.contract?.customer?.companyName} · {item.contract?.customer?.province || item.contract?.customer?.businessLine}</p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{STATUS_LABELS[item.status] || item.status}</span>
            </div>
            <p className="text-sm text-gray-700">申请原因：{item.reason}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-gray-500">
              <span>申请人：{item.requester?.name}</span>
              <span>审批人：{item.approver?.name || "-"}</span>
              <span>创建：{new Date(item.createdAt).toLocaleString("zh-CN")}</span>
            </div>
            {item.status === "PENDING" && (
              <div className="flex flex-col sm:flex-row gap-2">
                <input value={remark[item.id] || ""} onChange={(event) => setRemark({ ...remark, [item.id]: event.target.value })}
                  placeholder="审批备注，拒绝时必填"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                <button onClick={() => handleApprove(item.id)} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg">同意</button>
                <button onClick={() => handleReject(item.id)} className="px-4 py-2 border border-red-200 text-red-600 text-sm rounded-lg hover:bg-red-50">拒绝</button>
              </div>
            )}
            {item.approvalRemark && <p className="text-xs text-gray-500">审批备注：{item.approvalRemark}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
