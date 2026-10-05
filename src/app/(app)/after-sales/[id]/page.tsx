"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ServiceAmountInput } from "@/components/after-sales/service-amount-input";
import { ErpAttachments } from "@/components/erp/erp-attachments";
import { PageContainer } from "@/components/layout/page-container";
import {
  AFTER_SALES_ORDER_TYPE_LABELS,
  AFTER_SALES_PROBLEM_CATEGORY_LABELS,
  AFTER_SALES_PROBLEM_CATEGORIES,
  AFTER_SALES_SATISFACTION_LABELS,
  AFTER_SALES_SATISFACTIONS,
  AFTER_SALES_STATUS_LABELS,
} from "@/lib/after-sales";

function formatDate(value?: string | Date | null) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value))
    : "—";
}

export default function AfterSalesDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const [item, setItem] = useState<any>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [edit, setEdit] = useState<any>({});
  const [receipt, setReceipt] = useState({ completedDate: "", receiptContent: "", problemCategory: "MECHANICAL", otherReason: "", satisfaction: "", partNames: "" });

  const load = useCallback(async () => {
    const response = await fetch(`/api/after-sales/${id}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "售后工单加载失败");
      return;
    }
    setItem(data);
    setEdit({
      orderType: data.orderType,
      urgency: data.urgency,
      dispatchDate: String(data.dispatchDate).slice(0, 10),
      assigneeNames: data.assigneeNames,
      serviceAddress: data.serviceAddress || "",
      description: data.description,
      serviceAmount: data.serviceAmount?.toString() || "",
      partNames: data.parts.map((part: any) => part.partName).join("、"),
    });
    setReceipt((current) => ({ ...current, partNames: data.parts.map((part: any) => part.partName).join("、") }));
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeStatus = async (status: string) => {
    setError("");
    const response = await fetch(`/api/after-sales/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await response.json();
    if (!response.ok) return setError(data.error || "状态更新失败");
    setItem(data);
  };

  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const response = await fetch(`/api/after-sales/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...edit,
        serviceAmount: edit.orderType === "OUT_WARRANTY_PAID" ? edit.serviceAmount : null,
        partNames: String(edit.partNames).split(/[、,，;；]/).map((name) => name.trim()).filter(Boolean),
      }),
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) return setError(data.error || "工单编辑失败");
    setItem(data);
    setEditing(false);
  };

  const submitReceipt = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const response = await fetch(`/api/after-sales/${id}/receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...receipt,
        partNames: receipt.partNames.split(/[、,，;；]/).map((name) => name.trim()).filter(Boolean),
      }),
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) return setError(data.error || "回执提交失败");
    setItem(data);
  };

  const deleteOrder = async () => {
    if (!window.confirm("删除后列表中不再显示。确定删除该工单吗？")) return;
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/after-sales/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "删除售后工单失败");
        setDeleting(false);
        return;
      }
      router.push("/after-sales");
    } catch {
      setError("删除售后工单失败，请稍后重试");
      setDeleting(false);
    }
  };

  if (error && !item) return <PageContainer variant="data"><p className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</p></PageContainer>;
  if (!item) return <PageContainer variant="data"><p className="text-gray-500">加载中...</p></PageContainer>;

  const editable = ["PENDING_DISPATCH", "DISPATCHED"].includes(item.status);
  const canDelete = (session?.user as { role?: string } | undefined)?.role === "SUPER_ADMIN";

  return (
    <PageContainer variant="data" className="max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">售后服务工单</p>
          <h1 className="text-xl font-semibold">{item.orderNo}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/after-sales/${id}/print`} className="rounded border px-3 py-2 text-sm">打印工单</Link>
          <Link href="/after-sales" className="rounded border px-3 py-2 text-sm">返回列表</Link>
          {canDelete && (
            <button
              className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100 disabled:opacity-50"
              disabled={deleting}
              onClick={() => void deleteOrder()}
              type="button"
            >
              {deleting ? "删除中..." : "删除工单"}
            </button>
          )}
        </div>
      </div>

      {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-5 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">基本信息</h2>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-sm">
            {item.urgency === "URGENT" ? "紧急 · " : ""}
            {AFTER_SALES_STATUS_LABELS[item.status as keyof typeof AFTER_SALES_STATUS_LABELS]}
          </span>
        </div>
        {editing ? (
          <form onSubmit={saveEdit} className="mt-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">工单类型
                <select value={edit.orderType} onChange={(event) => setEdit((current: any) => ({ ...current, orderType: event.target.value }))} className="mt-1 w-full rounded border p-2">
                  {Object.entries(AFTER_SALES_ORDER_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="text-sm">紧急程度
                <select value={edit.urgency} onChange={(event) => setEdit((current: any) => ({ ...current, urgency: event.target.value }))} className="mt-1 w-full rounded border p-2">
                  <option value="NORMAL">一般</option>
                  <option value="URGENT">紧急</option>
                </select>
              </label>
              <label className="text-sm">派发时间
                <input required type="date" value={edit.dispatchDate} onChange={(event) => setEdit((current: any) => ({ ...current, dispatchDate: event.target.value }))} className="mt-1 w-full rounded border p-2" />
              </label>
              <label className="text-sm">售后人员
                <input required value={edit.assigneeNames} onChange={(event) => setEdit((current: any) => ({ ...current, assigneeNames: event.target.value }))} className="mt-1 w-full rounded border p-2" />
              </label>
              <label className="text-sm md:col-span-2">服务地址
                <input value={edit.serviceAddress} maxLength={255} onChange={(event) => setEdit((current: any) => ({ ...current, serviceAddress: event.target.value }))} placeholder="选填，默认可留空" className="mt-1 w-full rounded border p-2" />
              </label>
              {edit.orderType === "OUT_WARRANTY_PAID" && (
                <label className="text-sm">服务金额
                  <ServiceAmountInput required value={edit.serviceAmount} onChange={(value) => setEdit((current: any) => ({ ...current, serviceAmount: value }))} />
                </label>
              )}
            </div>
            <label className="block text-sm">工单说明
              <textarea required value={edit.description} onChange={(event) => setEdit((current: any) => ({ ...current, description: event.target.value }))} className="mt-1 min-h-28 w-full rounded border p-2" />
            </label>
            <label className="block text-sm">涉及配件（用顿号、逗号或分号分隔）
              <input value={edit.partNames} onChange={(event) => setEdit((current: any) => ({ ...current, partNames: event.target.value }))} className="mt-1 w-full rounded border p-2" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className="rounded border px-3 py-2 text-sm">取消</button>
              <button disabled={saving} className="rounded bg-[var(--brand-orange)] px-3 py-2 text-sm text-white disabled:opacity-50">保存</button>
            </div>
          </form>
        ) : (
          <>
            <div className="mt-4 grid gap-4 text-sm md:grid-cols-3">
              <Info label="客户公司" value={item.customerNameSnapshot} />
              <Info label="合同编号" value={item.contractNoSnapshot} />
              <Info label="设备型号" value={item.equipmentModelSnapshot} />
              <Info label="工单类型" value={AFTER_SALES_ORDER_TYPE_LABELS[item.orderType as keyof typeof AFTER_SALES_ORDER_TYPE_LABELS]} />
              <Info label="售后人员" value={item.assigneeNames} />
              <Info label="派发时间" value={formatDate(item.dispatchDate)} />
              <Info label="服务地址" value={item.serviceAddress} />
              {item.serviceAmount !== null && <Info label="服务金额（仅记录）" value={`¥${item.serviceAmount}`} />}
            </div>
            <div className="mt-4">
              <p className="text-sm text-gray-500">工单说明</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.description}</p>
            </div>
            <div className="mt-4">
              <p className="text-sm text-gray-500">涉及配件</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {item.parts.length
                  ? item.parts.map((part: any) => <span key={part.id} className="rounded-full bg-orange-50 px-2 py-1 text-xs text-orange-700">{part.partName}</span>)
                  : <span className="text-sm text-gray-500">未填写</span>}
              </div>
            </div>
            {editable && <button type="button" onClick={() => setEditing(true)} className="mt-4 rounded border px-3 py-2 text-sm">编辑工单</button>}
          </>
        )}
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-5 shadow-[var(--shadow-card)]">
        <h2 className="font-medium">状态与现场回执</h2>
        {item.status === "PENDING_DISPATCH" && <button onClick={() => void changeStatus("DISPATCHED")} className="mt-3 rounded bg-[var(--brand-orange)] px-3 py-2 text-sm text-white">标记为已派发</button>}
        {item.status === "DISPATCHED" && <button onClick={() => void changeStatus("IN_PROGRESS")} className="mt-3 rounded bg-[var(--brand-orange)] px-3 py-2 text-sm text-white">开始处理</button>}
        {item.status === "IN_PROGRESS" && (
          <form onSubmit={submitReceipt} className="mt-3 space-y-3">
            <label className="block text-sm">完成时间
              <input required type="date" value={receipt.completedDate} onChange={(event) => setReceipt((current) => ({ ...current, completedDate: event.target.value }))} className="mt-1 w-full rounded border p-2" />
            </label>
            <label className="block text-sm">回执内容
              <textarea required value={receipt.receiptContent} onChange={(event) => setReceipt((current) => ({ ...current, receiptContent: event.target.value }))} className="mt-1 min-h-28 w-full rounded border p-2" />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">问题分类
                <select value={receipt.problemCategory} onChange={(event) => setReceipt((current) => ({ ...current, problemCategory: event.target.value }))} className="mt-1 w-full rounded border p-2">
                  {AFTER_SALES_PROBLEM_CATEGORIES.map((type) => <option key={type} value={type}>{AFTER_SALES_PROBLEM_CATEGORY_LABELS[type]}</option>)}
                </select>
              </label>
              <label className="text-sm">满意度
                <select value={receipt.satisfaction} onChange={(event) => setReceipt((current) => ({ ...current, satisfaction: event.target.value }))} className="mt-1 w-full rounded border p-2">
                  <option value="">未选择</option>
                  {AFTER_SALES_SATISFACTIONS.map((value) => <option key={value} value={value}>{AFTER_SALES_SATISFACTION_LABELS[value]}</option>)}
                </select>
              </label>
              {receipt.problemCategory === "OTHER" && <label className="text-sm">其他原因<input required value={receipt.otherReason} onChange={(event) => setReceipt((current) => ({ ...current, otherReason: event.target.value }))} className="mt-1 w-full rounded border p-2" /></label>}
            </div>
            <label className="block text-sm">涉及配件（用顿号、逗号或分号分隔）
              <input value={receipt.partNames} onChange={(event) => setReceipt((current) => ({ ...current, partNames: event.target.value }))} className="mt-1 w-full rounded border p-2" />
            </label>
            <button disabled={saving} className="rounded bg-[var(--brand-orange)] px-3 py-2 text-sm text-white disabled:opacity-50">提交回执并完成工单</button>
          </form>
        )}
        {["COMPLETED", "CLOSED"].includes(item.status) && (
          <div className="mt-3 space-y-2 text-sm">
            <Info label="完成时间" value={formatDate(item.completedDate)} />
            <Info label="回执提交时间" value={formatDate(item.receiptAt)} />
            <Info label="问题分类" value={item.problemCategory ? AFTER_SALES_PROBLEM_CATEGORY_LABELS[item.problemCategory as keyof typeof AFTER_SALES_PROBLEM_CATEGORY_LABELS] : "—"} />
            <Info label="满意度" value={item.satisfaction ? AFTER_SALES_SATISFACTION_LABELS[item.satisfaction as keyof typeof AFTER_SALES_SATISFACTION_LABELS] : "未评价"} />
            {item.otherReason && <Info label="其他原因" value={item.otherReason} />}
            <p className="whitespace-pre-wrap break-words rounded bg-gray-50 p-3">{item.receiptContent || "—"}</p>
            {item.status === "COMPLETED" && <button onClick={() => void changeStatus("CLOSED")} className="rounded bg-[var(--brand-orange)] px-3 py-2 text-sm text-white">已上传签字附件，关闭工单</button>}
          </div>
        )}
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-5 shadow-[var(--shadow-card)]">
        <h2 className="font-medium">客户签字附件</h2>
        <p className="mt-1 text-xs text-gray-500">已完成工单上传客户签字纸质单照片或扫描件后，才能关闭。</p>
        <ErpAttachments entityType="AFTER_SALES_ORDER" entityId={item.id} />
      </section>
    </PageContainer>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return <div><p className="text-xs text-gray-500">{label}</p><p className="mt-1 break-words">{value || "—"}</p></div>;
}
