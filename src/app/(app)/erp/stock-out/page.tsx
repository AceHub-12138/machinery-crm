"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Plus, Search, Trash2, Eye, ArrowUpFromLine } from "lucide-react";
import { MaterialCombobox } from "@/components/erp/material-combobox";
import { ErpAttachments, PendingErpAttachments, uploadErpAttachments } from "@/components/erp/erp-attachments";
import { collectPrintResults } from "@/lib/print-results";
import { PageContainer } from "@/components/layout/page-container";

export default function StockOutPage() {
  const { data: session } = useSession();
  const userRole = (session?.user as any)?.role;
  const canEdit = userRole === "SUPER_ADMIN" || userRole === "WAREHOUSE";

  const [tab, setTab] = useState<"form" | "history">("history");
  const [stockOuts, setStockOuts] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [inventories, setInventories] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [filterWarehouse, setFilterWarehouse] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterCreatorId, setFilterCreatorId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [creators, setCreators] = useState<any[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [printItems, setPrintItems] = useState<any[] | null>(null);
  const [printing, setPrinting] = useState(false);

  // Form state
  const [warehouseId, setWarehouseId] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [stockOutType, setStockOutType] = useState("PRODUCTION");
  const [remark, setRemark] = useState("");
  const [items, setItems] = useState<any[]>([{ materialId: "", quantity: "" }]);
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
    if (warehouseId) {
      fetch(`/api/erp/inventory?warehouseId=${warehouseId}&pageSize=100`)
        .then((r) => r.json())
        .then((data) => setInventories(data.items || []));
    }
  }, [warehouseId]);

  useEffect(() => {
    if (tab !== "history") return;
    setLoading(true);
    const params = buildHistoryParams();
    params.set("page", String(page));
    params.set("pageSize", "20");
    fetch(`/api/erp/stock-out?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setStockOuts(data.items || []);
        setPagination(data.pagination || { page: 1, pageSize: 20, total: 0, totalPages: 0 });
      })
      .finally(() => setLoading(false));
  }, [tab, filterWarehouse, filterType, filterDateFrom, filterDateTo, filterSearch, filterCreatorId, filterStatus, page]);

  const viewDetail = async (id: string) => {
    const res = await fetch(`/api/erp/stock-out/${id}`);
    const data = await res.json();
    setDetail(data);
    setDetailId(id);
  };

  const addItem = () => setItems([...items, { materialId: "", quantity: "" }]);
  const removeItem = (index: number) => setItems(items.filter((_, i) => i !== index));
  const updateItem = (index: number, field: string, value: string) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  };

  const getAvailableQty = (materialId: string): number => {
    const inv = inventories.find((i) => i.materialId === materialId);
    return inv ? Number(inv.quantity) : 0;
  };

  const handleSubmit = async () => {
    if (!warehouseId || items.length === 0) return;
    const validItems = items.filter((i) => i.materialId && i.quantity);
    if (validItems.length === 0) return;

    // Client-side stock check
    for (const item of validItems) {
      const available = getAvailableQty(item.materialId);
      if (parseFloat(item.quantity) > available) {
        const mat = materials.find((m) => m.id === item.materialId);
        alert(`物料【${mat?.name || item.materialId}】库存不足：需要 ${item.quantity}，可用 ${available}`);
        return;
      }
    }

    setSaving(true);
    const res = await fetch("/api/erp/stock-out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchNo, warehouseId, type: stockOutType, remark, items: validItems }),
    });
    const data = await res.json();
    if (!res.ok) {
      setSaving(false);
      alert(data.error || "出库失败");
      return;
    }
    const failedAttachments = await uploadErpAttachments("STOCK_OUT", data.id, pendingAttachments);
    setSaving(false);
    if (failedAttachments.length) alert(`出库单已创建，但以下附件上传失败，可在出库详情中重试：${failedAttachments.join("、")}`);
    setBatchNo("");
    setWarehouseId("");
    setRemark("");
    setItems([{ materialId: "", quantity: "" }]);
    setPendingAttachments([]);
    setTab("history");
  };

  const handlePrint = async () => {
    setPrinting(true);
    try {
      const filters = buildHistoryParams();
      const result = await collectPrintResults(async (printPage, printPageSize) => {
        const params = new URLSearchParams(filters);
        params.set("page", String(printPage));
        params.set("pageSize", String(printPageSize));
        const response = await fetch(`/api/erp/stock-out?${params.toString()}`);
        if (!response.ok) throw new Error("加载出库打印数据失败");
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
      alert(error instanceof Error ? error.message : "加载出库打印数据失败");
    }
  };

  const visibleStockOuts = printItems ?? stockOuts;

  return (
    <PageContainer variant="data" className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-gray-900">出库单</h1>
        <button type="button" onClick={handlePrint} disabled={printing} className="print-hidden rounded border px-3 py-2 text-sm disabled:opacity-50">{printing ? "准备打印..." : "打印当前筛选结果"}</button>
        {canEdit && (
          <button
            onClick={() => setTab("form")}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800"
          >
            <Plus className="w-4 h-4" />新增出库
          </button>
        )}
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        <button onClick={() => setTab("history")} className={`px-4 py-2 rounded-md text-sm font-medium ${tab === "history" ? "bg-white shadow" : "text-gray-600"}`}>出库记录</button>
        <button onClick={() => setTab("form")} className={`px-4 py-2 rounded-md text-sm font-medium ${tab === "form" ? "bg-white shadow" : "text-gray-600"}`}>新增出库</button>
      </div>

      {tab === "form" && canEdit && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><label className="block text-xs font-medium text-gray-600 mb-1">出库单号（选填）</label><input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="留空自动生成" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">仓库 *</label>
              <select value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setItems([{ materialId: "", quantity: "" }]); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">请选择仓库</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">出库类型</label>
              <select value={stockOutType} onChange={(e) => setStockOutType(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="PRODUCTION">生产领用</option>
                <option value="CHECK_OUT">盘亏出库</option>
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
              <h3 className="text-sm font-semibold text-gray-700">出库明细</h3>
              <button onClick={addItem} className="text-xs text-gray-600 hover:text-gray-900 border px-2 py-1 rounded">+ 添加行</button>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="flex flex-col gap-2 lg:flex-row lg:items-center">
                  <MaterialCombobox
                    materials={materials}
                    value={item.materialId}
                    onChange={(materialId) => updateItem(idx, "materialId", materialId)}
                  />
                  <input type="number" placeholder="数量" value={item.quantity} onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm sm:w-24" />
                  <span className="w-full text-xs text-gray-500 sm:w-16">
                    {item.materialId && parseFloat(item.quantity || "0") > getAvailableQty(item.materialId) ? (
                      <span className="text-red-500">超库存!</span>
                    ) : item.materialId ? (
                      <span>可用 {getAvailableQty(item.materialId)}</span>
                    ) : null}
                  </span>
                  {items.length > 1 && (
                    <button onClick={() => removeItem(idx)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <PendingErpAttachments files={pendingAttachments} onChange={setPendingAttachments} />

          <div className="flex justify-end gap-2">
            <button onClick={() => { setPendingAttachments([]); setTab("history"); }} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">取消</button>
            <button onClick={handleSubmit} disabled={saving || !warehouseId || items.filter(i => i.materialId && i.quantity).length === 0}
              className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
              {saving ? "保存中..." : "确认出库"}
            </button>
          </div>
        </div>
      )}

      {tab === "history" && (
        <>
          <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-4 shadow-[var(--shadow-card)]">
            <div className="mb-3 text-sm font-medium text-gray-700">筛选出库记录</div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_150px_150px_150px_minmax(220px,1.4fr)_auto]">
              <select value={filterWarehouse} onChange={(e) => { setFilterWarehouse(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm"><option value="">全部仓库</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
              <select value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm"><option value="">全部类型</option><option value="PRODUCTION">生产领用</option><option value="CHECK_OUT">盘亏出库</option><option value="OTHER">其他</option></select>
              <input type="date" aria-label="开始日期" value={filterDateFrom} onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input type="date" aria-label="结束日期" value={filterDateTo} onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input value={filterSearch} onChange={(e) => { setFilterSearch(e.target.value); setPage(1); }} placeholder="物料名称、编码或出库单号" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <select value={filterCreatorId} onChange={(e) => { setFilterCreatorId(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm"><option value="">全部创建人</option>{creators.map((creator) => <option key={creator.id} value={creator.id}>{creator.name || "未命名用户"}</option>)}</select>
              <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm"><option value="">全部状态</option><option value="CONFIRMED">已确认</option></select>
              <button type="button" onClick={() => { setFilterWarehouse(""); setFilterType(""); setFilterDateFrom(""); setFilterDateTo(""); setFilterSearch(""); setFilterCreatorId(""); setFilterStatus(""); setPage(1); }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">清空</button>
            </div>
          </div>

          {loading ? (
            <p className="text-center py-8 text-sm text-gray-500">加载中...</p>
          ) : visibleStockOuts.length === 0 ? (
            <p className="text-center py-8 text-sm text-gray-500">暂无出库记录</p>
          ) : (
            <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] shadow-[var(--shadow-card)]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-[var(--border)] bg-[var(--surface-muted)]">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">单号</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">仓库</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">类型</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">明细数</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">日期</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">详情</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStockOuts.map((so) => (
                    <tr key={so.id} className="h-12 border-b border-[var(--border)] hover:bg-[var(--surface-hover)]">
                      <td className="px-4 py-3 font-mono text-xs">{so.batchNo}</td>
                      <td className="px-4 py-3 text-gray-500">{so.warehouse?.name}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                          {so.type === "PRODUCTION" ? "生产领用" : so.type === "CHECK_OUT" ? "盘亏" : "其他"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">{so.items?.length || 0} 项</td>
                      <td className="px-4 py-3 text-gray-500">{new Date(so.createdAt).toLocaleDateString("zh-CN")}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => viewDetail(so.id)} className="text-gray-400 hover:text-gray-700"><Eye className="w-4 h-4" /></button>
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
            <h2 className="text-lg font-semibold mb-4">出库单详情 - {detail.batchNo}</h2>
            <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
              <p><span className="text-gray-500">仓库：</span>{detail.warehouse?.name}</p>
              <p><span className="text-gray-500">类型：</span>{detail.type}</p>
              <p><span className="text-gray-500">日期：</span>{new Date(detail.createdAt).toLocaleDateString("zh-CN")}</p>
              <p><span className="text-gray-500">备注：</span>{detail.remark || "-"}</p>
            </div>
            <table className="w-full text-sm border">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">物料</th>
                  <th className="px-3 py-2 text-right">数量</th>
                </tr>
              </thead>
              <tbody>
                {detail.items?.map((item: any) => (
                  <tr key={item.id} className="border-t">
                    <td className="px-3 py-2">{item.materialNameSnapshot || item.material?.name} <span className="text-gray-400 text-xs">({item.materialCodeSnapshot || item.material?.code})</span><div className="text-xs text-gray-400">{item.materialSpecSnapshot || item.material?.spec || "—"}</div></td>
                    <td className="px-3 py-2 text-right">{Number(item.quantity).toLocaleString()} {item.unitSnapshot || item.material?.unit}<div className="text-xs text-gray-400">库存 {Number(item.beforeQty ?? 0)} → {Number(item.afterQty ?? 0)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ErpAttachments entityType="STOCK_OUT" entityId={detail.id} />
            <div className="text-right mt-2">
              <button onClick={() => setDetailId(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">关闭</button>
            </div>
          </div>
        </div>
      )}
      <style jsx global>{`@media print { aside, button, input, select, textarea, .print-hidden, [role="dialog"] { display: none !important; } main { margin: 0 !important; } }`}</style>
    </PageContainer>
  );
}
