"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, CheckCheck, PackageCheck, PackagePlus, Plus, Save, Trash2, XCircle } from "lucide-react";
import { MaterialCombobox } from "@/components/erp/material-combobox";

type OrderLine = { materialId: string; quantity: string; unitPrice: string };

const statusLabel: Record<string, string> = { DRAFT: "草稿", ORDERED: "已下单", PARTIAL_RECEIVED: "部分到货", RECEIVED: "已到货", CANCELLED: "已取消" };

function dateInputValue(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function money(value: number) { return `¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`; }

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const orderId = String(params.id || "");
  const isNew = orderId === "new";
  const canEdit = (session?.user as any)?.role === "SUPER_ADMIN" || (session?.user as any)?.role === "PURCHASE";
  const [materials, setMaterials] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ supplierId: "", orderDate: dateInputValue(new Date()), expectedArrivalDate: "", remark: "", items: [{ materialId: "", quantity: "1", unitPrice: "" }] as OrderLine[] });

  useEffect(() => {
    Promise.all([
      fetch("/api/erp/materials").then((res) => res.json()),
      fetch("/api/erp/suppliers").then((res) => res.json()),
    ]).then(([materialData, supplierData]) => {
      setMaterials(Array.isArray(materialData) ? materialData : []);
      setSuppliers(supplierData.items || []);
    });
  }, []);

  const loadOrder = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    await fetch(`/api/erp/purchase-orders/${orderId}`)
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (!ok) {
          setError(data.error || "加载采购订单失败");
          return;
        }
        setOrder(data);
        setForm({
          supplierId: data.supplierId,
          orderDate: dateInputValue(data.orderDate),
          expectedArrivalDate: dateInputValue(data.expectedArrivalDate),
          remark: data.remark || "",
          items: (data.items || []).map((item: any) => ({ materialId: item.materialId, quantity: String(item.quantity), unitPrice: String(item.unitPrice) })),
        });
      })
      .finally(() => setLoading(false));
  }, [isNew, orderId]);

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  const isDraft = isNew || order?.status === "DRAFT";
  const editable = canEdit && isDraft;
  const activeSuppliers = useMemo(() => suppliers.filter((supplier) => supplier.isActive || supplier.id === form.supplierId), [suppliers, form.supplierId]);
  const materialById = useMemo(() => new Map(materials.map((material) => [material.id, material])), [materials]);
  const total = form.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);

  const updateLine = (index: number, field: keyof OrderLine, value: string) => setForm((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) }));
  const addLine = () => setForm((current) => ({ ...current, items: [...current.items, { materialId: "", quantity: "1", unitPrice: "" }] }));
  const removeLine = (index: number) => setForm((current) => ({ ...current, items: current.items.length > 1 ? current.items.filter((_, itemIndex) => itemIndex !== index) : current.items }));

  const save = async () => {
    if (!editable) return;
    setSaving(true);
    setError("");
    const payload = { ...form, items: form.items.filter((item) => item.materialId) };
    const res = await fetch(isNew ? "/api/erp/purchase-orders" : `/api/erp/purchase-orders/${orderId}`, {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "保存采购订单失败");
      return;
    }
    if (isNew) {
      router.replace(`/erp/purchase-orders/${data.id}`);
      return;
    }
    setOrder(data);
  };

  const changeStatus = async (status: string) => {
    if (!order || changingStatus) return;
    if (status === "CANCELLED" && !window.confirm("确认取消这张采购订单吗？取消后不能恢复。")) return;
    setChangingStatus(true);
    setError("");
    const res = await fetch(`/api/erp/purchase-orders/${orderId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    setChangingStatus(false);
    if (!res.ok) {
      setError(data.error || "变更采购订单状态失败");
      return;
    }
    await loadOrder();
  };

  if (loading) return <p className="py-8 text-center text-sm text-gray-500">加载中...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div><Link href="/erp/purchase-orders" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"><ArrowLeft className="h-4 w-4" />返回采购订单</Link><h1 className="mt-2 text-xl font-semibold text-gray-900">{isNew ? "新增采购订单" : order?.orderNo || "采购订单详情"}</h1></div>
        {!isNew && order && <span className="rounded-full bg-gray-100 px-2.5 py-1 text-sm text-gray-700">{statusLabel[order.status] || order.status}</span>}
      </div>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!isNew && !isDraft && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">该采购订单的供应商和采购明细已锁定，请按当前状态执行后续操作。</p>}
      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block text-xs font-medium text-gray-600"><span className="mb-1 block">供应商 *</span><select value={form.supplierId} disabled={!editable} onChange={(event) => setForm({ ...form, supplierId: event.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50">{isNew && <option value="">请选择供应商</option>}{activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}{supplier.isActive ? "" : "（已停用）"}</option>)}</select></label>
          <label className="block text-xs font-medium text-gray-600"><span className="mb-1 block">订单日期 *</span><input type="date" value={form.orderDate} disabled={!editable} onChange={(event) => setForm({ ...form, orderDate: event.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50" /></label>
          <label className="block text-xs font-medium text-gray-600"><span className="mb-1 block">预计到货日期</span><input type="date" value={form.expectedArrivalDate} disabled={!editable} onChange={(event) => setForm({ ...form, expectedArrivalDate: event.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50" /></label>
        </div>
        <label className="block text-xs font-medium text-gray-600"><span className="mb-1 block">备注</span><textarea value={form.remark} disabled={!editable} onChange={(event) => setForm({ ...form, remark: event.target.value })} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50" /></label>
      </section>
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 p-4"><div><h2 className="text-sm font-semibold text-gray-900">采购明细</h2><p className="mt-1 text-xs text-gray-500">金额由数量与单价自动计算，并在服务端重新计算后保存。</p></div>{editable && <button onClick={addLine} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><Plus className="h-4 w-4" />添加行</button>}</div>
        <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-sm"><thead className="bg-gray-50"><tr><th className="px-3 py-2 text-left font-medium text-gray-600">物料</th><th className="px-3 py-2 text-left font-medium text-gray-600">规格</th><th className="px-3 py-2 text-right font-medium text-gray-600">数量</th><th className="px-3 py-2 text-right font-medium text-gray-600">单价</th><th className="px-3 py-2 text-right font-medium text-gray-600">金额</th><th className="px-3 py-2 text-right font-medium text-gray-600">已到货 / 待入库</th>{editable && <th className="px-3 py-2 text-center font-medium text-gray-600">操作</th>}</tr></thead><tbody>{form.items.map((item, index) => { const material = materialById.get(item.materialId); const receivedQuantity = Number(order?.items?.[index]?.receivedQuantity || 0); const remainingQuantity = Math.max(0, Number(item.quantity || 0) - receivedQuantity); return <tr key={index} className="border-t border-gray-100"><td className="px-3 py-2">{editable ? <MaterialCombobox materials={materials} value={item.materialId} onChange={(value) => updateLine(index, "materialId", value)} /> : <span className="font-medium text-gray-900">{material ? `${material.code} - ${material.name}` : order?.items?.[index]?.materialNameSnapshot || "-"}</span>}</td><td className="px-3 py-2 text-gray-600">{material?.spec || order?.items?.[index]?.materialSpecSnapshot || "-"}</td><td className="px-3 py-2 text-right">{editable ? <input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(event) => updateLine(index, "quantity", event.target.value)} className="w-24 rounded-lg border border-gray-300 px-2 py-2 text-right text-sm" /> : item.quantity}</td><td className="px-3 py-2 text-right">{editable ? <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => updateLine(index, "unitPrice", event.target.value)} className="w-28 rounded-lg border border-gray-300 px-2 py-2 text-right text-sm" /> : money(Number(item.unitPrice || 0))}</td><td className="px-3 py-2 text-right font-medium">{money(Number(item.quantity || 0) * Number(item.unitPrice || 0))}</td><td className="px-3 py-2 text-right text-gray-600">{receivedQuantity.toLocaleString()} / {remainingQuantity.toLocaleString()}</td>{editable && <td className="px-3 py-2 text-center"><button title="删除明细行" onClick={() => removeLine(index)} className="text-gray-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></td>}</tr>; })}</tbody></table></div>
        <div className="border-t border-gray-200 px-4 py-3 text-right text-sm font-semibold text-gray-900">合计金额：{money(total)}</div>
      </section>
      {editable && <div className="flex justify-end"><button onClick={save} disabled={saving || !form.supplierId || !form.orderDate || form.items.filter((item) => item.materialId).length === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"><Save className="h-4 w-4" />{saving ? "保存中..." : isNew ? "创建草稿" : "保存草稿"}</button></div>}
      {!isNew && order && canEdit && <div className="flex flex-wrap justify-end gap-2">
        {(order.status === "ORDERED" || order.status === "PARTIAL_RECEIVED") && <button onClick={() => router.push(`/erp/stock-in?purchaseOrderId=${orderId}`)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm text-white hover:bg-blue-800"><PackagePlus className="h-4 w-4" />生成入库单</button>}
        {order.status === "DRAFT" && <><button onClick={() => changeStatus("ORDERED")} disabled={changingStatus} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"><PackageCheck className="h-4 w-4" />下单</button><button onClick={() => changeStatus("CANCELLED")} disabled={changingStatus} className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"><XCircle className="h-4 w-4" />取消</button></>}
        {order.status === "ORDERED" && <><button onClick={() => changeStatus("PARTIAL_RECEIVED")} disabled={changingStatus} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 px-4 py-2 text-sm text-amber-800 hover:bg-amber-50 disabled:opacity-50"><PackageCheck className="h-4 w-4" />标记部分到货</button><button onClick={() => changeStatus("RECEIVED")} disabled={changingStatus} className="inline-flex items-center gap-1.5 rounded-lg bg-green-700 px-4 py-2 text-sm text-white hover:bg-green-800 disabled:opacity-50"><CheckCheck className="h-4 w-4" />标记已到货</button><button onClick={() => changeStatus("CANCELLED")} disabled={changingStatus} className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"><XCircle className="h-4 w-4" />取消</button></>}
        {order.status === "PARTIAL_RECEIVED" && <button onClick={() => changeStatus("RECEIVED")} disabled={changingStatus} className="inline-flex items-center gap-1.5 rounded-lg bg-green-700 px-4 py-2 text-sm text-white hover:bg-green-800 disabled:opacity-50"><CheckCheck className="h-4 w-4" />标记已到货</button>}
      </div>}
    </div>
  );
}
