"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { PageContainer } from "@/components/layout/page-container";

const ACTION_LABELS: Record<string, string> = {
  CREATE_PAYMENT: "新增回款",
  UPDATE_PAYMENT: "修改回款",
  DELETE_PAYMENT: "删除回款",
  UPDATE_CONTRACT: "修改合同",
  DELETE_CONTRACT: "删除合同",
  QUOTE_TO_CONTRACT: "一键转合同",
  QUOTE_UPDATE_CONTRACT: "报价更新合同",
  REQUEST_CONTRACT_UNLOCK: "申请合同解锁",
  APPROVE_CONTRACT_UNLOCK: "同意合同解锁",
  REJECT_CONTRACT_UNLOCK: "拒绝合同解锁",
  CREATE_USER: "新增用户",
  UPDATE_USER: "修改用户",
  DISABLE_USER: "禁用用户",
  TRANSFER_AND_DISABLE_USER: "转移并禁用用户",
  CREATE_CUSTOMER: "新增客户",
  UPDATE_CUSTOMER: "编辑客户",
  DELETE_CUSTOMER: "删除客户",
  CREATE_CUSTOMER_QUOTE: "新增客户报价",
  CREATE_SHIPMENT: "新增发货",
  UPDATE_SHIPMENT: "修改发货",
  CREATE_AFTER_SALES_ORDER: "新建售后工单",
  UPDATE_AFTER_SALES_ORDER: "编辑售后工单",
  SUBMIT_AFTER_SALES_RECEIPT: "提交售后回执",
  UPDATE_AFTER_SALES_STATUS: "流转售后工单状态",
  DELETE_AFTER_SALES_ORDER: "删除售后工单",
  CREATE_AFTER_SALES_SUPPLEMENT_PART: "新增售后补充配件",
};

const ENTITY_LABELS: Record<string, string> = {
  User: "用户",
  Customer: "客户",
  Contract: "合同",
  ContractPayment: "回款",
  ContractUnlockRequest: "审批",
  CustomerQuote: "客户报价",
  Shipment: "发货记录",
  AfterSalesOrder: "售后工单",
  AfterSalesSupplementPart: "售后补充配件",
};

export default function OperationLogsPage() {
  const { data: session } = useSession();
  const [logs, setLogs] = useState<any[]>([]);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [error, setError] = useState("");

  const userRole = (session?.user as any)?.role;

  const fetchLogs = () => {
    const params = new URLSearchParams();
    if (action) params.set("action", action);
    if (entityType) params.set("entityType", entityType);
    fetch(`/api/system/audit/search?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => Array.isArray(data.items) ? setLogs(data.items) : setError(data.error || "读取日志失败"))
      .catch(() => setError("读取日志失败"));
  };

  useEffect(() => {
    if (userRole === "SUPER_ADMIN") fetchLogs();
  }, [action, entityType, userRole]);

  if (userRole && userRole !== "SUPER_ADMIN") {
    return <p className="text-center py-8 text-red-600">无权查看操作日志</p>;
  }

  return (
    <PageContainer variant="data" className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-gray-900">操作日志</h1>
        <div className="flex flex-wrap gap-2">
          <select value={action} onChange={(event) => setAction(event.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">全部操作</option>
            {Object.entries(ACTION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select value={entityType} onChange={(event) => setEntityType(event.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">全部对象</option>
            {Object.entries(ENTITY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="hidden md:grid grid-cols-[140px_110px_1fr_160px] gap-3 px-4 py-3 text-xs font-medium text-gray-500 bg-gray-50">
          <span>操作</span>
          <span>对象</span>
          <span>对象ID</span>
          <span>操作人 / 时间</span>
        </div>
        {logs.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">暂无日志</p>
        ) : logs.map((log) => (
          <details key={log.id} className="border-t border-gray-100">
            <summary className="grid md:grid-cols-[140px_110px_1fr_160px] gap-3 px-4 py-3 text-sm cursor-pointer hover:bg-gray-50">
              <span className="font-medium text-gray-900">{ACTION_LABELS[log.action] || log.action}</span>
              <span className="text-gray-600">{ENTITY_LABELS[log.entityType] || log.entityType}</span>
              <span className="text-gray-500 truncate">{log.entityId}</span>
              <span className="text-xs text-gray-500">{log.user?.name || "-"}<br />{new Date(log.createdAt).toLocaleString("zh-CN")}</span>
            </summary>
            <div className="grid md:grid-cols-2 gap-3 px-4 pb-4">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">修改前</p>
                <pre className="max-h-64 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">{JSON.stringify(log.beforeData, null, 2) || "-"}</pre>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">修改后</p>
                <pre className="max-h-64 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">{JSON.stringify(log.afterData, null, 2) || "-"}</pre>
              </div>
            </div>
          </details>
        ))}
      </div>
    </PageContainer>
  );
}
