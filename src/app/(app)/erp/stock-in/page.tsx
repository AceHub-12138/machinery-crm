"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { AlertTriangle, Eye, Link2Off, Plus, Trash2 } from "lucide-react";
import { MaterialCombobox } from "@/components/erp/material-combobox";
import { ErpAttachments, PendingErpAttachments, uploadErpAttachments } from "@/components/erp/erp-attachments";
import { collectPrintResults } from "@/lib/print-results";
import { PageContainer } from "@/components/layout/page-container";

function StockInContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const purchaseOrderId = searchParams.get("purchaseOrderId") || "";
  const { data: session } = useSession();
  const userRole = (session?.user as any)?.role;
  const canEdit = userRole === "SUPER_ADMIN" || userRole === "WAREHOUSE";

  const [tab, setTab] = useState<"form" | "history">("history");
  const [stockIns, setStockIns] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [filterWarehouse, setFilterWarehouse] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterCreatorId, setFilterCreatorId] = useState("");
  const [filterStatus, setFilterStatus] = useState("CONFIRMED");
  const [creators, setCreators] = useState<any[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [correctionTarget, setCorrectionTarget] = useState<any>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [purchaseSource, setPurchaseSource] = useState<any>(null);
  const [formError, setFormError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [printItems, setPrintItems] = useState<any[] | null>(null);
  const [printing, setPrinting] = useState(false);

  // Form state
  const [warehouseId, setWarehouseId] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [stockInType, setStockInType] = useState("PURCHASE");
  const [remark, setRemark] = useState("");
  const [items, setItems] = useState<any[]>([{ materialId: "", quantity: "", unitPrice: "" }]);
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/erp/warehouses?onlyActive=1").then((r) => r.json()).then((d) => setWarehouses(Array.isArray(d) ? d : []));
    fetch("/api/erp/materials").then((r) => r.json()).then((d) => setMaterials(Array.isArray(d) ? d : []));
    fetch("/api/erp/document-creators").then((r) => r.json()).then((d) => setCreators(Array.isArray(d) ? d : []));
  }, []);

  const buildHistoryParams = () => {
    const params = new URLSearchParams();
    if (filterWarehouse) params.set("warehouseId", filterWarehouse);
    if (filterType) params.set("type", filterType);
    if (filterDateFrom) params.set("dateFrom", filterDateFrom);
    if (filterDateTo) params.set("dateTo", filterDateTo);
    if (filterSearch.trim()) params.set("search", filterSearch.trim());
    if (filterCreatorId) params.set("createdById", filterCreatorId);
    if (filterStatus) params.set("status", filterStatus);
    return params;
  };

  useEffect(() => {
    if (tab !== "history") return;
    setLoading(true);
    const params = buildHistoryParams();
    params.set("page", String(page));
    params.set("pageSize", "20");
    fetch(`/api/erp/stock-in?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setStockIns(data.items || []);
        setPagination(data.pagination || { page: 1, pageSize: 20, total: 0, totalPages: 0 });
      })
      .finally(() => setLoading(false));
  }, [tab, filterWarehouse, filterType, filterDateFrom, filterDateTo, filterSearch, filterCreatorId, filterStatus, page, refreshKey]);

  useEffect(() => {
    if (!purchaseOrderId) {
      setPurchaseSource(null);
      return;
    }
    setFormError("");
    fetch(`/api/erp/purchase-orders/${purchaseOrderId}`)
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (!ok) {
          setFormError(data.error || "加载采购订单失败");
          return;
        }
        if (data.status !== "ORDERED" && data.status !== "PARTIAL_RECEIVED") {
          setFormError("只有已下单或部分到货状态的采购订单可以生成入库单");
          return;
        }
        const availableItems = (data.items || []).map((item: any) => {
          const remaining = Number(item.quantity) - Number(item.receivedQuantity || 0);
          return {
            materialId: item.materialId,
            purchaseOrderItemId: item.id,
            quantity: remaining > 0 ? String(remaining) : "",
            unitPrice: String(item.unitPrice || ""),
            maxQuantity: remaining,
          };
        }).filter((item: any) => item.maxQuantity > 0);
        if (availableItems.length === 0) {
          setFormError("该采购订单没有可入库的剩余明细");
          return;
        }
        setPurchaseSource({ id: data.id, orderNo: data.orderNo, status: data.status });
        setStockInType("PURCHASE");
        setRemark(`采购订单 ${data.orderNo} 入库`);
        setItems(availableItems);
        setTab("form");
      });
  }, [purchaseOrderId]);

  const viewDetail = async (id: string) => {
    const res = await fetch(`/api/erp/stock-in/${id}`);
    const data = await res.json();
    setDetail(data);
    setDetailId(id);
  };

  const addItem = () => setItems([...items, { materialId: "", quantity: "", unitPrice: "" }]);
  const removeItem = (index: number) => setItems(items.filter((_, i) => i !== index));
  const updateItem = (index: number, field: string, value: string) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  };

  const handleSubmit = async () => {
    if (!warehouseId || items.length === 0) return;
    const validItems = items.filter((i) => i.materialId && i.quantity && i.unitPrice && (!purchaseSource || i.purchaseOrderItemId));
    if (validItems.length === 0) return;
    if (purchaseSource && validItems.some((item) => Number(item.quantity) > Number(item.maxQuantity))) {
      setFormError("入库数量不能超过采购订单明细的剩余到货数量");
      return;
    }
    setFormError("");
    setSaving(true);
    const res = await fetch("/api/erp/stock-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchNo, warehouseId, type: stockInType, remark, purchaseOrderId: purchaseSource?.id, items: validItems }),
    });
    const data = await res.json();
    if (!res.ok) {
      setSaving(false);
      setFormError(data.error || "保存入库单失败");
      return;
    }
    const failedAttachments = await uploadErpAttachments("STOCK_IN", data.id, pendingAttachments);
    setSaving(false);
    setPendingAttachments([]);
    if (failedAttachments.length) {
      const message = `入库单已创建，但以下附件上传失败，可在入库详情中重试：${failedAttachments.join("、")}`;
      setFormError(message);
      alert(message);
    }
    if (purchaseSource) {
      router.replace(`/erp/purchase-orders/${purchaseSource.id}`);
      return;
    }
    setBatchNo("");
    setWarehouseId("");
    setRemark("");
    setItems([{ materialId: "", quantity: "", unitPrice: "" }]);
    setTab("history");
    setRefreshKey((value) => value + 1);
  };

  const cancelForm = () => {
    setFormError("");
    setBatchNo("");
    setWarehouseId("");
    setRemark("");
    setItems([{ materialId: "", quantity: "", unitPrice: "" }]);
    setPendingAttachments([]);
    if (purchaseSource) {
      setPurchaseSource(null);
      router.replace("/erp/stock-in");
      return;
    }
    setTab("history");
  };

  const unlinkPurchase = async (stockIn: any) => {
    if (!window.confirm(`确认撤销入库单 ${stockIn.batchNo} 与采购订单的关联吗？库存不会回退。`)) return;
    const res = await fetch(`/api/erp/stock-in/${stockIn.id}/unlink-purchase`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setFormError(data.error || "撤销采购关联失败");
      return;
    }
    setFormError("");
    setRefreshKey((value) => value + 1);
    if (detailId === stockIn.id) setDetail(null);
  };

  const openVoidDialog = (stockIn: any) => {
    setFormError("");
    setVoidReason("");
    setCorrectionTarget(stockIn);
  };

  const voidStockIn = async () => {
    if (!correctionTarget || voidReason.trim().length < 5) return;
    setVoiding(true);
    const res = await fetch(`/api/erp/stock-in/${correctionTarget.id}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: voidReason }),
    });
    const data = await res.json();
    setVoiding(false);
    if (!res.ok) {
      setFormError(data.error || "入库单作废失败");
      return;
    }
    setFormError("");
    setCorrectionTarget(null);
    setVoidReason("");
    setRefreshKey((value) => value + 1);
    if (detailId === data.id) await viewDetail(data.id);
  };

  const handlePrint = async () => {
    setPrinting(true);
    try {
      const filters = buildHistoryParams();
      const result = await collectPrintResults(async (printPage, printPageSize) => {
        const params = new URLSearchParams(filters);
        params.set("page", String(printPage));
        params.set("pageSize", String(printPageSize));
        const response = await fetch(`/api/erp/stock-in?${params.toString()}`);
        if (!response.ok) throw new Error("加载入库打印数据失败");
        const data = await response.json();
        return { items: data.items || [], total: data.pagination?.total || 0 };
      });
      setPrintItems(result.items);
      setTab("history");
      if (result.truncated) alert("结果超过1000条，仅打印前1000条，请收窄筛选条件");
      const restore = () => {
        setPrintItems(null);
        setPrinting(false);
      };
      window.addEventListener("afterprint", restore, { once: true });
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.print()));
    } catch (error) {
      setPrinting(false);
      alert(error instanceof Error ? error.message : "加载入库打印数据失败");
    }
  };

  const totalAmount = items.reduce((sum, i) => sum + (parseFloat(i.quantity || "0") * parseFloat(i.unitPrice || "0")), 0);
  const visibleStockIns = printItems ?? stockIns;

  return (
    <PageContainer variant="data" className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-gray-900">入库单</h1>
        <button type="button" onClick={handlePrint} disabled={printing} className="print-hidden rounded border px-3 py-2 text-sm disabled:opacity-50">{printing ? "准备打印..." : "打印当前筛选结果"}</button>
        {canEdit && (
          <button
            onClick={() => {
              setPurchaseSource(null);
              router.replace("/erp/stock-in");
              setTab("form");
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800"
          >
            <Plus className="w-4 h-4" />新增入库
          </button>
        )}
      </div>

      {formError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        <button onClick={() => setTab("history")} className={`px-4 py-2 rounded-md text-sm font-medium ${tab === "history" ? "bg-white shadow" : "text-gray-600"}`}>入库记录</button>
        <button onClick={() => { setPurchaseSource(null); router.replace("/erp/stock-in"); setTab("form"); }} className={`px-4 py-2 rounded-md text-sm font-medium ${tab === "form" ? "bg-white shadow" : "text-gray-600"}`}>新增入库</button>
      </div>

      {tab === "form" && canEdit && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          {purchaseSource && <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">来源采购订单：<span className="font-medium">{purchaseSource.orderNo}</span>。物料明细已锁定，可按实际到货数量调整。</div>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><label className="block text-xs font-medium text-gray-600 mb-1">入库单号</label><input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="留空自动生成（如 2026081101）" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">仓库 *</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">请选择仓库</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">入库类型</label>
              <select value={stockInType} disabled={Boolean(purchaseSource)} onChange={(e) => setStockInType(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50">
                <option value="PURCHASE">采购入库</option>
                <option value="RETURN">退货入库</option>
                <option value="INITIAL">期初入库</option>
                <option value="CHECK_IN">盘盈入库</option>
                <option value="OTHER">其他</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">备注</label>
              <input value={remark} onChange={(e) => setRemark(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700">入库明细</h3>
              {!purchaseSource && <button onClick={addItem} className="text-xs text-gray-600 hover:text-gray-900 border px-2 py-1 rounded">+ 添加行</button>}
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="flex flex-col gap-2 lg:flex-row lg:items-center">
                  {purchaseSource ? <div className="min-w-[220px] flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">{(() => { const material = materials.find((value) => value.id === item.materialId); return material ? `${material.code} - ${material.name}` : "采购物料"; })()}</div> : <MaterialCombobox materials={materials} value={item.materialId} onChange={(materialId) => updateItem(idx, "materialId", materialId)} />}
                  <div className="w-full sm:w-28"><input type="number" min="0.01" max={purchaseSource ? item.maxQuantity : undefined} step="0.01" placeholder="数量" value={item.quantity} onChange={(e) => updateItem(idx, "quantity", e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />{purchaseSource && <p className="mt-1 text-xs text-gray-500">最多 {Number(item.maxQuantity).toLocaleString()}</p>}</div>
                  <input type="number" placeholder="单价" value={item.unitPrice} onChange={(e) => updateItem(idx, "unitPrice", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm sm:w-24" />
                  <span className="w-full text-right text-sm text-gray-500 sm:w-24">
                    ¥{((parseFloat(item.quantity || "0")) * parseFloat(item.unitPrice || "0")).toLocaleString()}
                  </span>
                  {!purchaseSource && items.length > 1 && (
                    <button onClick={() => removeItem(idx)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
              ))}
            </div>
            <div className="text-right mt-2 text-sm font-semibold text-gray-900">
              合计金额：¥{totalAmount.toLocaleString()}
            </div>
          </div>

          <PendingErpAttachments files={pendingAttachments} onChange={setPendingAttachments} />

          <div className="flex justify-end gap-2">
            <button onClick={cancelForm} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">取消</button>
            <button onClick={handleSubmit} disabled={saving || !warehouseId || items.filter(i => i.materialId && i.quantity && i.unitPrice && (!purchaseSource || i.purchaseOrderItemId)).length === 0}
              className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
              {saving ? "保存中..." : "确认入库"}
            </button>
          </div>
        </div>
      )}

      {tab === "history" && (
        <>
          <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-4 shadow-[var(--shadow-card)]">
            <div className="mb-3 text-sm font-medium text-gray-700">筛选入库记录</div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_150px_150px_150px_minmax(220px,1.4fr)_auto]">
              <select value={filterWarehouse} onChange={(e) => { setFilterWarehouse(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm"><option value="">全部仓库</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
              <select value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm"><option value="">全部类型</option><option value="PURCHASE">采购入库</option><option value="RETURN">退货入库</option><option value="INITIAL">期初入库</option><option value="CHECK_IN">盘盈入库</option><option value="OTHER">其他</option></select>
              <input type="date" aria-label="开始日期" value={filterDateFrom} onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input type="date" aria-label="结束日期" value={filterDateTo} onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input value={filterSearch} onChange={(e) => { setFilterSearch(e.target.value); setPage(1); }} placeholder="物料名称、编码或入库单号" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <select value={filterCreatorId} onChange={(e) => { setFilterCreatorId(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm"><option value="">全部创建人</option>{creators.map((creator) => <option key={creator.id} value={creator.id}>{creator.name || "未命名用户"}</option>)}</select>
              <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm"><option value="">全部状态</option><option value="CONFIRMED">已确认</option><option value="VOIDED">已作废</option></select>
              <button type="button" onClick={() => { setFilterWarehouse(""); setFilterType(""); setFilterDateFrom(""); setFilterDateTo(""); setFilterSearch(""); setFilterCreatorId(""); setFilterStatus(""); setPage(1); }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">清空</button>
            </div>
          </div>

          {loading ? (
            <p className="text-center py-8 text-sm text-gray-500">加载中...</p>
          ) : visibleStockIns.length === 0 ? (
            <p className="text-center py-8 text-sm text-gray-500">暂无入库记录</p>
          ) : (
            <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] shadow-[var(--shadow-card)]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-[var(--border)] bg-[var(--surface-muted)]">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">单号</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">仓库</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">类型</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">状态</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">来源采购单</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">明细数</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">日期</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStockIns.map((si) => (
                    <tr key={si.id} className={`h-12 border-b border-[var(--border)] hover:bg-[var(--surface-hover)] ${si.status === "VOIDED" ? "bg-red-50" : ""}`}>
                      <td className="px-4 py-3 font-mono text-xs">{si.batchNo}</td>
                      <td className="px-4 py-3 text-gray-500">{si.warehouse?.name}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                          {si.type === "PURCHASE" ? "采购" : si.type === "RETURN" ? "退货" : si.type === "INITIAL" ? "期初" : si.type === "CHECK_IN" ? "盘盈" : "其他"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${si.status === "VOIDED" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                          {si.status === "VOIDED" ? "已作废" : "已确认"}
                        </span>
                        {si.status === "VOIDED" && <div className="mt-1 max-w-56 text-xs text-red-600"><div>时间：{si.voidedAt ? new Date(si.voidedAt).toLocaleString("zh-CN") : "-"}</div><div>作废人：{si.voidedBy?.name || si.voidedById || "-"}</div>{si.voidReason && <div className="print-void-reason">原因：{si.voidReason}</div>}</div>}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{si.purchaseOrder?.orderNo || "-"}</td>
                      <td className="px-4 py-3 text-right">{si.items?.length || 0} 项</td>
                      <td className="px-4 py-3 text-gray-500">{new Date(si.createdAt).toLocaleDateString("zh-CN")}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => viewDetail(si.id)} className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-900">
                            <Eye className="w-4 h-4" />查看
                          </button>
                          {canEdit && si.status === "CONFIRMED" && (
                            <button onClick={() => openVoidDialog(si)} className="inline-flex items-center gap-1 text-amber-600 hover:text-amber-800">
                              <AlertTriangle className="w-4 h-4" />纠错/作废
                            </button>
                          )}
                          {canEdit && si.purchaseOrderId && (
                            <button onClick={() => unlinkPurchase(si)} className="inline-flex items-center gap-1 text-red-600 hover:text-red-800">
                              <Link2Off className="w-4 h-4" />撤销采购关联
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40">上一页</button>
              <span className="text-sm text-gray-500">第 {page} / {pagination.totalPages} 页</span>
              <button onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page >= pagination.totalPages} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40">下一页</button>
            </div>
          )}
        </>
      )}

      {/* Detail Modal */}
      {detailId && detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDetailId(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl shadow-xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">入库单详情 - {detail.batchNo}</h2>
            <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
              <p><span className="text-gray-500">仓库：</span>{detail.warehouse?.name}</p>
              <p><span className="text-gray-500">类型：</span>{detail.type}</p>
              <p><span className="text-gray-500">日期：</span>{new Date(detail.createdAt).toLocaleDateString("zh-CN")}</p>
              <p><span className="text-gray-500">备注：</span>{detail.remark || "-"}</p>
              <p><span className="text-gray-500">来源采购单：</span>{detail.purchaseOrder?.orderNo || detail.purchaseOrderId || "-"}</p>
              <p><span className="text-gray-500">状态：</span><span className={detail.status === "VOIDED" ? "font-medium text-red-700" : "font-medium text-emerald-700"}>{detail.status === "VOIDED" ? "已作废" : "已确认"}</span></p>
            </div>
            {detail.status === "VOIDED" && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                <p className="font-medium">该入库单已作废，原始入库与库存流水均保留。</p>
                <p className="mt-1">作废时间：{detail.voidedAt ? new Date(detail.voidedAt).toLocaleString("zh-CN") : "-"}</p>
                <p>作废人：{detail.voidedBy?.name || detail.voidedById || "-"}</p>
                <p>作废原因：{detail.voidReason || "-"}</p>
              </div>
            )}
            <table className="w-full text-sm border">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">物料</th>
                  <th className="px-3 py-2 text-right">数量</th>
                  <th className="px-3 py-2 text-right">单价</th>
                  <th className="px-3 py-2 text-right">金额</th>
                </tr>
              </thead>
              <tbody>
                {detail.items?.map((item: any) => (
                  <tr key={item.id} className="border-t">
                    <td className="px-3 py-2">{item.materialNameSnapshot || item.material?.name} <span className="text-gray-400 text-xs">({item.materialCodeSnapshot || item.material?.code})</span><div className="text-xs text-gray-400">{item.materialSpecSnapshot || item.material?.spec || "—"}</div></td>
                    <td className="px-3 py-2 text-right">{Number(item.quantity).toLocaleString()} {item.unitSnapshot || item.material?.unit}<div className="text-xs text-gray-400">库存 {Number(item.beforeQty ?? 0)} → {Number(item.afterQty ?? 0)}</div></td>
                    <td className="px-3 py-2 text-right">¥{Number(item.unitPrice).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-medium">¥{Number(item.amount).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {detail.voidRecord?.items?.length > 0 && (
              <div className="mt-4 rounded-lg border border-red-200 p-3 text-sm">
                <h3 className="font-medium text-red-800">作废反向冲减明细</h3>
                {detail.voidRecord.items.map((item: any) => <p key={item.id} className="mt-1 text-gray-700">{item.material?.code || item.materialId} {item.material?.name || ""}：冲减 {Number(item.quantity).toLocaleString()}，库存 {Number(item.beforeQty).toLocaleString()} → {Number(item.afterQty).toLocaleString()}，冲减金额 ¥{Number(item.reversalAmount).toLocaleString()}</p>)}
              </div>
            )}
            {detail.stockMovements?.length > 0 && (
              <div className="mt-4 rounded-lg border border-gray-200 p-3 text-sm">
                <h3 className="font-medium text-gray-800">库存流水</h3>
                {detail.stockMovements.map((movement: any) => <p key={movement.id} className="mt-1 text-gray-600">{new Date(movement.createdAt).toLocaleString("zh-CN")} · {movement.type === "STOCK_OUT" ? "作废冲减" : "原入库"} · {movement.material?.code || movement.materialId} · {Number(movement.beforeQty).toLocaleString()} → {Number(movement.afterQty).toLocaleString()}</p>)}
              </div>
            )}
            {detail.operationLogs?.length > 0 && (
              <div className="mt-4 rounded-lg border border-gray-200 p-3 text-sm">
                <h3 className="font-medium text-gray-800">操作日志</h3>
                {detail.operationLogs.map((log: any) => <p key={log.id} className="mt-1 text-gray-600">{new Date(log.createdAt).toLocaleString("zh-CN")} · {log.action === "VOID_STOCK_IN" ? "作废入库单" : log.action === "CREATE_STOCK_IN" ? "创建入库单" : log.action}</p>)}
              </div>
            )}
            <ErpAttachments entityType="STOCK_IN" entityId={detail.id} />
            <div className="text-right mt-2">
              <button onClick={() => setDetailId(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">关闭</button>
            </div>
          </div>
        </div>
      )}
      <style jsx global>{`@media print { aside, button, input, select, textarea, .print-hidden, [role="dialog"] { display: none !important; } main { margin: 0 !important; } .print-void-reason { white-space: normal !important; overflow: visible !important; text-overflow: clip !important; } }`}</style>

      {correctionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setCorrectionTarget(null)}>
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
              <div>
                <h2 className="text-lg font-semibold text-gray-900">入库单纠错/作废</h2>
                <p className="mt-1 text-sm text-gray-600">单号 {correctionTarget.batchNo} 已提交并影响库存，不能直接编辑明细或删除。</p>
              </div>
            </div>
            {correctionTarget.purchaseOrderId ? (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p>该单来自采购入库，不能直接作废。</p><p>请先使用“撤销采购关联”纠正采购收货（unlink-purchase），再按库存纠正流程处理。</p></div>
            ) : correctionTarget.productionOrderId ? (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p>该单为生产退料，不能直接作废。</p><p>请通过生产工单变更审批纠正退料，避免已退料汇总与工单版本脱节。</p></div>
            ) : correctionTarget.status !== "CONFIRMED" ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">该入库单不是可作废的已确认状态。</div>
            ) : (
              <div className="space-y-2"><p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">作废会追加反向库存流水，原入库单、明细和历史流水均不会删除或改写。</p><label className="block text-sm font-medium text-gray-700">作废原因（5–500 字）</label><textarea value={voidReason} onChange={(event) => setVoidReason(event.target.value)} maxLength={500} rows={4} placeholder="请说明作废原因" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  viewDetail(correctionTarget.id);
                  setCorrectionTarget(null);
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                查看原单
              </button>
              {correctionTarget.status === "CONFIRMED" && !correctionTarget.purchaseOrderId && !correctionTarget.productionOrderId && <button onClick={voidStockIn} disabled={voiding || voidReason.trim().length < 5} className="rounded-lg bg-red-700 px-4 py-2 text-sm text-white hover:bg-red-800 disabled:opacity-50">{voiding ? "作废中..." : "确认作废"}</button>}
              <button onClick={() => { setCorrectionTarget(null); setVoidReason(""); }} className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800">关闭</button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

export default function StockInPage() {
  return (
    <Suspense fallback={<div className="py-8 text-center text-gray-500">加载中...</div>}>
      <StockInContent />
    </Suspense>
  );
}
