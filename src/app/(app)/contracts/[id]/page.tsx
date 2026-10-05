"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, Download, Edit, Plus, Trash2 } from "lucide-react";
import { toProtectedUploadUrl } from "@/lib/upload-urls";

function formatMoney(value: any) {
  if (value === null || value === undefined || value === "") return "-";
  return `¥${Number(value).toLocaleString("zh-CN")}`;
}

const PAYMENT_STATUS: Record<string, { label: string; color: string }> = {
  UNPAID: { label: "未收款", color: "bg-red-50 text-red-700" },
  PARTIAL_PAID: { label: "部分收款", color: "bg-yellow-50 text-yellow-700" },
  PAID: { label: "已收款", color: "bg-green-50 text-green-700" },
};

const CONTRACT_STATUS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "草稿", color: "bg-gray-100 text-gray-700" },
  SIGNED: { label: "已签约", color: "bg-blue-50 text-blue-700" },
  CANCELLED: { label: "已取消", color: "bg-red-50 text-red-600" },
  COMPLETED: { label: "已完成", color: "bg-green-50 text-green-700" },
  ARCHIVED: { label: "已归档", color: "bg-slate-100 text-slate-700" },
};

const SHIPMENT_STATUS: Record<string, { label: string; color: string }> = {
  NOT_SHIPPED: { label: "未发货", color: "bg-gray-100 text-gray-700" },
  PARTIAL_SHIPPED: { label: "部分发货", color: "bg-yellow-50 text-yellow-700" },
  SHIPPED: { label: "已发货", color: "bg-green-50 text-green-700" },
};

const PAYMENT_METHODS = ["银行转账", "现金", "微信", "支付宝", "承兑", "其他"];

export default function ContractDetailPage() {
  const { data: session } = useSession();
  const canCreateProductionOrder = (session?.user as any)?.role === "SUPER_ADMIN";
  const params = useParams();
  const router = useRouter();
  const [contract, setContract] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [editingPayment, setEditingPayment] = useState<any>(null);
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    paymentDate: new Date().toISOString().split("T")[0],
    paymentMethod: "银行转账",
    remark: "",
  });
  const [savingPayment, setSavingPayment] = useState(false);
  const [showUnlockForm, setShowUnlockForm] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");

  const fetchContract = () => {
    setLoading(true);
    fetch(`/api/contracts/${params.id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "无权访问或合同不存在");
        return data;
      })
      .then(setContract)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchContract();
  }, [params.id]);

  const resetPaymentForm = () => {
    setPaymentForm({
      amount: "",
      paymentDate: new Date().toISOString().split("T")[0],
      paymentMethod: "银行转账",
      remark: "",
    });
    setEditingPayment(null);
  };

  const submitPayment = async () => {
    setActionError("");
    if (!paymentForm.amount || !paymentForm.paymentDate) {
      setActionError("请填写回款金额和回款日期");
      return;
    }
    setSavingPayment(true);
    const url = editingPayment
      ? `/api/contracts/${params.id}/payments/${editingPayment.id}`
      : `/api/contracts/${params.id}/payments`;
    const method = editingPayment ? "PUT" : "POST";
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(paymentForm),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || "保存回款失败");
        return;
      }
      resetPaymentForm();
      setShowPaymentForm(false);
      fetchContract();
    } finally {
      setSavingPayment(false);
    }
  };

  const startEditPayment = (payment: any) => {
    setEditingPayment(payment);
    setPaymentForm({
      amount: String(Number(payment.amount || 0)),
      paymentDate: new Date(payment.paymentDate).toISOString().split("T")[0],
      paymentMethod: payment.paymentMethod || "银行转账",
      remark: payment.remark || "",
    });
    setShowPaymentForm(true);
  };

  const voidPayment = async (payment: any) => {
    if (!confirm("确定要删除该回款记录吗？系统会保留记录并标记为作废。")) return;
    setActionError("");
    const res = await fetch(`/api/contracts/${params.id}/payments/${payment.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setActionError(data.error || "删除回款失败");
      return;
    }
    fetchContract();
  };

  const requestUnlock = async () => {
    setActionError("");
    if (!unlockReason.trim()) {
      setActionError("请填写申请原因");
      return;
    }
    const res = await fetch("/api/contract-unlock-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractId: params.id, reason: unlockReason }),
    });
    const data = await res.json();
    if (!res.ok) {
      setActionError(data.error || "提交申请失败");
      return;
    }
    setShowUnlockForm(false);
    setUnlockReason("");
    fetchContract();
  };

  if (loading) return <p className="text-center py-8 text-gray-500">加载中...</p>;
  if (error) return <p className="text-center py-8 text-red-600">{error}</p>;
  if (!contract) return null;

  const items = contract.items?.length ? contract.items : [{
    id: "legacy-main",
    itemType: "MAIN",
    productNameSnapshot: contract.equipmentName,
    productModelSnapshot: contract.equipmentModel,
    factoryPriceSnapshot: contract.product?.factoryPrice,
    contractPrice: contract.amount,
    quantity: 1,
  }];
  const payments = contract.payments || [];
  const activePayments = payments.filter((payment: any) => payment.status !== "VOIDED");
  const pendingUnlock = contract.unlockRequests?.find((item: any) => item.status === "PENDING");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-gray-900">合同 {contract.contractNo}</h1>
          <p className="text-sm text-gray-500">{contract.customer?.companyName}</p>
        </div>
        {canCreateProductionOrder && contract.contractStatus === "SIGNED" && <Link href={`/erp/production-orders/new?contractId=${contract.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><Plus className="h-4 w-4" />转生产工单</Link>}
        {contract.canEdit ? (
          <Link href={`/contracts/${contract.id}/edit`} className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800">
            <Edit className="w-4 h-4" /> 编辑合同
          </Link>
        ) : (
          <button onClick={() => setShowUnlockForm(true)} className="inline-flex items-center gap-1.5 px-4 py-2 bg-yellow-600 text-white text-sm font-medium rounded-lg hover:bg-yellow-700">
            申请修改
          </button>
        )}
      </div>

      {contract.isLocked && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          当前合同已锁定，如需修改，请联系超级管理员审批。
          {contract.canEdit && <span className="ml-2 font-medium">该合同已有有效审批，可编辑一次。</span>}
          {pendingUnlock && <span className="ml-2 font-medium">已有待审批申请。</span>}
        </div>
      )}
      {actionError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>}

      {showUnlockForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">申请修改锁定合同</h2>
          <textarea
            value={unlockReason}
            onChange={(event) => setUnlockReason(event.target.value)}
            rows={3}
            placeholder="请填写申请原因和需要修改的内容"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none"
          />
          <div className="flex gap-2">
            <button onClick={requestUnlock} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800">提交申请</button>
            <button onClick={() => setShowUnlockForm(false)} className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50">取消</button>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">合同信息</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-gray-500">合同编号</dt><dd className="text-gray-900">{contract.contractNo}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">签约日期</dt><dd className="text-gray-900">{new Date(contract.signedDate).toLocaleDateString("zh-CN")}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">预计发货</dt><dd className="text-gray-900">{contract.estimatedShipmentDate ? new Date(contract.estimatedShipmentDate).toLocaleDateString("zh-CN") : "未设置"}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">客户</dt><dd><Link href={`/customers/${contract.customer?.id}`} className="text-gray-900 hover:underline">{contract.customer?.companyName}</Link></dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">销售</dt><dd className="text-gray-900">{contract.salesUser?.name}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">状态</dt><dd><span className={`text-xs px-2 py-0.5 rounded-full ${CONTRACT_STATUS[contract.contractStatus]?.color}`}>{CONTRACT_STATUS[contract.contractStatus]?.label || contract.contractStatus}</span></dd></div>
              {contract.sourceQuoteId && <div className="flex justify-between"><dt className="text-gray-500">来源报价</dt><dd className="text-gray-900">{contract.sourceQuoteId.slice(0, 8)}</dd></div>}
              {contract.attachmentUrl && (
                <div className="flex justify-between"><dt className="text-gray-500">附件</dt><dd><a href={toProtectedUploadUrl(contract.attachmentUrl)} target="_blank" className="text-blue-600 hover:underline flex items-center gap-1"><Download className="w-3 h-3" />下载</a></dd></div>
              )}
              {contract.remark && <div><dt className="text-gray-500">备注</dt><dd className="text-gray-700 mt-0.5">{contract.remark}</dd></div>}
            </dl>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">回款汇总</h2>
            <div className="space-y-2">
              <div className="flex justify-between text-sm"><span className="text-gray-500">合同金额</span><span className="font-semibold text-gray-900">{formatMoney(contract.amount)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">已收款</span><span className="font-semibold text-green-700">{formatMoney(contract.paidAmount)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">未收款</span><span className="font-semibold text-red-600">{formatMoney(contract.unpaidAmount)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">付款状态</span><span className={`text-xs px-2 py-0.5 rounded-full ${PAYMENT_STATUS[contract.paymentStatus]?.color}`}>{PAYMENT_STATUS[contract.paymentStatus]?.label || contract.paymentStatus}</span></div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">合同产品明细</h2>
            <div className="space-y-3">
              {items.map((item: any) => (
                <div key={item.id} className="p-3 border border-gray-100 rounded-lg">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-gray-900">
                      {item.itemType === "MAIN" ? "产品" : "选配"}：{item.productNameSnapshot} {item.productModelSnapshot}
                    </p>
                    <p className="text-sm font-semibold text-gray-900">{formatMoney(Number(item.contractPrice || 0) * Number(item.quantity || 1))}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-500">
                    <span>单价：{formatMoney(item.contractPrice)}</span>
                    <span>数量：{item.quantity || 1}</span>
                    <span>小计：{formatMoney(Number(item.contractPrice || 0) * Number(item.quantity || 1))}</span>
                    <span>出厂价快照：{formatMoney(item.factoryPriceSnapshot)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-700">回款记录</h2>
              <button
                onClick={() => { resetPaymentForm(); setShowPaymentForm(!showPaymentForm); }}
                disabled={!contract.canEdit}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
              >
                <Plus className="w-3 h-3" /> 新增回款
              </button>
            </div>

            {showPaymentForm && (
              <div className="border border-gray-200 rounded-lg p-4 mb-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input type="number" min="0" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} placeholder="回款金额"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                  <input type="date" value={paymentForm.paymentDate} onChange={(event) => setPaymentForm({ ...paymentForm, paymentDate: event.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                  <select value={paymentForm.paymentMethod} onChange={(event) => setPaymentForm({ ...paymentForm, paymentMethod: event.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                    {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
                  </select>
                  <input type="text" value={paymentForm.remark} onChange={(event) => setPaymentForm({ ...paymentForm, remark: event.target.value })} placeholder="备注"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                </div>
                <div className="flex gap-2">
                  <button onClick={submitPayment} disabled={savingPayment} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50">{savingPayment ? "保存中..." : editingPayment ? "保存修改" : "保存回款"}</button>
                  <button onClick={() => { resetPaymentForm(); setShowPaymentForm(false); }} className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50">取消</button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {payments.length === 0 && <p className="text-sm text-gray-400">暂无回款记录</p>}
              {payments.map((payment: any) => (
                <div key={payment.id} className={`p-3 rounded-lg border ${payment.status === "VOIDED" ? "border-gray-100 bg-gray-50 opacity-70" : "border-gray-100"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{formatMoney(payment.amount)} {payment.status === "VOIDED" && <span className="ml-2 text-xs text-gray-500">已作废</span>}</p>
                      <p className="text-xs text-gray-500 mt-1">{new Date(payment.paymentDate).toLocaleDateString("zh-CN")} · {payment.paymentMethod || "未填写方式"} · {payment.createdBy?.name || ""}</p>
                      {payment.remark && <p className="text-xs text-gray-500 mt-1">{payment.remark}</p>}
                    </div>
                    {contract.canEdit && payment.status !== "VOIDED" && (
                      <div className="flex gap-1">
                        <button onClick={() => startEditPayment(payment)} className="p-1.5 text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100"><Edit className="w-3.5 h-3.5" /></button>
                        <button onClick={() => voidPayment(payment)} className="p-1.5 text-gray-400 hover:text-red-600 rounded hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {activePayments.length > 0 && <p className="text-xs text-gray-400">有效回款合计：{formatMoney(contract.paidAmount)}</p>}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">发货记录</h2>
            <div className="space-y-2">
              {!contract.shipments?.length && <p className="text-sm text-gray-400">暂无发货记录</p>}
              {contract.shipments?.map((shipment: any) => (
                <div key={shipment.id} className="p-3 border border-gray-100 rounded-lg">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900">{new Date(shipment.shipmentDate).toLocaleDateString("zh-CN")}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${SHIPMENT_STATUS[shipment.shipmentStatus]?.color}`}>{SHIPMENT_STATUS[shipment.shipmentStatus]?.label || shipment.shipmentStatus}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{shipment.equipmentName} · 数量 {shipment.quantity}</p>
                  <p className="text-xs text-gray-500 mt-1">{shipment.receivingAddress}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
