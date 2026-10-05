"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Plus, CheckCircle, Info, Trash2 } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";

const STOCK_CHECK_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  CHECKING: "盘点中",
  DONE: "已完成",
};

export default function StockCheckPage() {
  const { data: session } = useSession();
  const userRole = (session?.user as any)?.role;
  const canEdit = userRole === "SUPER_ADMIN" || userRole === "WAREHOUSE";

  const [tab, setTab] = useState<"form" | "history">("history");
  const [stockChecks, setStockChecks] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [filterWarehouse, setFilterWarehouse] = useState("");

  // Detail
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);

  // Form
  const [warehouseId, setWarehouseId] = useState("");
  const [remark, setRemark] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/erp/warehouses?onlyActive=1").then((r) => r.json()).then((d) => setWarehouses(Array.isArray(d) ? d : []));
  }, []);

  useEffect(() => {
    if (tab !== "history") return;
    setLoading(true);
    const params = new URLSearchParams();
    if (filterWarehouse) params.set("warehouseId", filterWarehouse);
    params.set("page", String(page));
    params.set("pageSize", "20");
    fetch(`/api/erp/stock-checks?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setStockChecks(data.items || []);
        setPagination(data.pagination || { page: 1, pageSize: 20, total: 0, totalPages: 0 });
      })
      .finally(() => setLoading(false));
  }, [tab, filterWarehouse, page]);

  const refreshStockChecks = async () => {
    const params = new URLSearchParams();
    if (filterWarehouse) params.set("warehouseId", filterWarehouse);
    params.set("page", String(page));
    params.set("pageSize", "20");
    const listRes = await fetch(`/api/erp/stock-checks?${params.toString()}`);
    const listData = await listRes.json();
    setStockChecks(listData.items || []);
    setPagination(listData.pagination || { page: 1, pageSize: 20, total: 0, totalPages: 0 });
  };

  const loadInventoryForWarehouse = async (wid: string) => {
    const res = await fetch(`/api/erp/inventory?warehouseId=${wid}&pageSize=100`);
    const data = await res.json();
    const invs = data.items || [];
    setItems(
      invs.map((inv: any) => ({
        materialId: inv.materialId,
        materialName: inv.material?.name || "",
        materialCode: inv.material?.code || "",
        unit: inv.material?.unit || "件",
        bookQty: String(inv.quantity),
        actualQty: "",
        reason: "",
      }))
    );
  };

  const viewDetail = async (id: string) => {
    const res = await fetch(`/api/erp/stock-checks/${id}`);
    const data = await res.json();
    setDetail(data);
    setDetailId(id);
  };

  const deleteDraft = async (stockCheck: any) => {
    if (stockCheck.status !== "DRAFT") {
      alert("已完成盘点单不能删除，如需纠错请重新创建盘点单或走管理员纠错流程。");
      return;
    }
    if (!confirm(`确定删除盘点草稿「${stockCheck.batchNo}」吗？`)) return;
    const res = await fetch(`/api/erp/stock-checks/${stockCheck.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || "删除盘点草稿失败");
      return;
    }
    if (detailId === stockCheck.id) {
      setDetailId(null);
      setDetail(null);
    }
    await refreshStockChecks();
  };

  const handleSubmitDraft = async () => {
    if (!warehouseId || items.length === 0) return;
    setSaving(true);
    const res = await fetch("/api/erp/stock-checks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        warehouseId,
        remark,
        checkDate: new Date().toISOString(),
        items: items.map((it) => ({
          materialId: it.materialId,
          bookQty: it.bookQty,
        })),
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (res.ok) {
      setWarehouseId("");
      setRemark("");
      setItems([]);
      setTab("history");
      // auto-view detail
      setDetailId(data.id);
      setDetail(data);
    }
  };

  const handleSubmitDone = async (id: string) => {
    if (!confirm("确定提交盘点单？提交后将更新库存数据，不可撤销。")) return;
    const checkItem = detail || await (await fetch(`/api/erp/stock-checks/${id}`)).json();
    const itemsWithActual = checkItem.items?.map((it: any, idx: number) => ({
      id: it.id,
      actualQty: it.actualQty !== null && it.actualQty !== undefined ? String(it.actualQty) : String(it.bookQty),
      reason: it.reason || "",
    }));

    const res = await fetch(`/api/erp/stock-checks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: itemsWithActual }),
    });
    const data = await res.json();
    if (res.ok) {
      setDetail(data);
      await refreshStockChecks();
    }
  };

  const updateDetailItem = (idx: number, field: string, value: string) => {
    if (!detail) return;
    const updated = { ...detail };
    updated.items = [...updated.items];
    updated.items[idx] = { ...updated.items[idx], [field]: value };
    setDetail(updated);
  };

  return (
    <PageContainer variant="data" className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-gray-900">盘点单</h1>
        {canEdit && (
          <button
            onClick={() => setTab("form")}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--brand-orange)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-orange-hover)]"
          >
            <Plus className="w-4 h-4" />新增盘点
          </button>
        )}
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        <button onClick={() => setTab("history")} className={`px-4 py-2 rounded-md text-sm font-medium ${tab === "history" ? "bg-white shadow" : "text-gray-600"}`}>盘点记录</button>
        <button onClick={() => setTab("form")} className={`px-4 py-2 rounded-md text-sm font-medium ${tab === "form" ? "bg-white shadow" : "text-gray-600"}`}>新增盘点</button>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <div className="mb-2 flex items-center gap-2 font-semibold">
          <Info className="h-4 w-4" />
          使用说明
        </div>
        <ol className="grid gap-1 sm:grid-cols-2">
          <li>1. 创建盘点单后，系统会自动读取当前库存作为账面数量。</li>
          <li>2. 仓库管理员根据实际库存填写实盘数量。</li>
          <li>3. 系统自动计算差异数量。</li>
          <li>4. 实盘数量大于账面数量，属于盘盈。</li>
          <li>5. 实盘数量小于账面数量，属于盘亏。</li>
          <li>6. 提交盘点后，系统根据差异自动调整库存，并生成库存流水。</li>
          <li>7. 已完成盘点单不允许随意修改。</li>
          <li>8. 如果后续发现错误，应重新创建盘点单或走管理员纠错流程。</li>
        </ol>
      </div>

      {tab === "form" && canEdit && (
          <div className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-6 shadow-[var(--shadow-card)]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">仓库 *</label>
              <select value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); loadInventoryForWarehouse(e.target.value); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">请选择仓库</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">备注</label>
              <input value={remark} onChange={(e) => setRemark(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>

          {items.length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-2">以下为当前库存快照，请创建盘点单后再录入实盘数量。</p>
              <div className="overflow-x-auto max-h-64 border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">物料编码</th>
                      <th className="px-3 py-2 text-left">名称</th>
                      <th className="px-3 py-2 text-right">账面数量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs">{it.materialCode}</td>
                        <td className="px-3 py-2">{it.materialName}</td>
                        <td className="px-3 py-2 text-right">{it.bookQty} {it.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={() => setTab("history")} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">取消</button>
            <button onClick={handleSubmitDraft} disabled={saving || !warehouseId || items.length === 0}
              className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
              {saving ? "保存中..." : "创建草稿"}
            </button>
          </div>
        </div>
      )}

      {tab === "history" && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex gap-3">
            <select value={filterWarehouse} onChange={(e) => { setFilterWarehouse(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">全部仓库</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>

          {loading ? (
            <p className="text-center py-8 text-sm text-gray-500">加载中...</p>
          ) : stockChecks.length === 0 ? (
            <p className="text-center py-8 text-sm text-gray-500">暂无盘点记录</p>
          ) : (
            <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] shadow-[var(--shadow-card)]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-[var(--border)] bg-[var(--surface-muted)]">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">单号</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">仓库</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">状态</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">明细数</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">盘点日期</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {stockChecks.map((sc) => (
                    <tr key={sc.id} className="h-12 border-b border-[var(--border)] hover:bg-[var(--surface-hover)]">
                      <td className="px-4 py-3 font-mono text-xs">{sc.batchNo}</td>
                      <td className="px-4 py-3 text-gray-500">{sc.warehouse?.name}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          sc.status === "DONE" ? "bg-green-100 text-green-700" :
                          sc.status === "CHECKING" ? "bg-amber-100 text-amber-700" :
                          "bg-gray-100 text-gray-600"
                        }`}>{STOCK_CHECK_STATUS_LABELS[sc.status] || sc.status}</span>
                      </td>
                      <td className="px-4 py-3 text-right">{sc.items?.length || 0} 项</td>
                      <td className="px-4 py-3 text-gray-500">{sc.checkDate ? new Date(sc.checkDate).toLocaleDateString("zh-CN") : "-"}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="inline-flex items-center gap-3 whitespace-nowrap">
                          <button onClick={() => viewDetail(sc.id)} className="text-xs text-gray-600 hover:text-gray-900">
                            修改
                          </button>
                          <button
                            onClick={() => deleteDraft(sc)}
                            disabled={sc.status !== "DRAFT"}
                            title={sc.status === "DRAFT" ? "删除盘点草稿" : "已完成盘点单不能删除"}
                            className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:text-gray-300"
                          >
                            <Trash2 className="w-3.5 h-3.5" />删除
                          </button>
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

      {/* Detail / Workflow Modal */}
      {detailId && detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDetailId(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-3xl shadow-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">盘点单 - {detail.batchNo}</h2>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                detail.status === "DONE" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
              }`}>{STOCK_CHECK_STATUS_LABELS[detail.status]}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
              <p><span className="text-gray-500">仓库：</span>{detail.warehouse?.name}</p>
              <p><span className="text-gray-500">盘点日期：</span>{detail.checkDate ? new Date(detail.checkDate).toLocaleDateString("zh-CN") : "-"}</p>
              <p><span className="text-gray-500">备注：</span>{detail.remark || "-"}</p>
            </div>

            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">物料</th>
                    <th className="px-3 py-2 text-right">账面数量</th>
                    <th className="px-3 py-2 text-right">实盘数量</th>
                    <th className="px-3 py-2 text-right">差异</th>
                    <th className="px-3 py-2 text-left">原因</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items?.map((item: any, idx: number) => {
                    const diff = item.diffQty !== null && item.diffQty !== undefined ? Number(item.diffQty) : null;
                    const actualStr = item.actualQty !== null && item.actualQty !== undefined ? String(item.actualQty) : "";
                    return (
                      <tr key={item.id} className={`border-t ${diff !== null && diff !== 0 ? "bg-yellow-50" : ""}`}>
                        <td className="px-3 py-2">{item.material?.name} <span className="text-gray-400 text-xs">({item.material?.code})</span></td>
                        <td className="px-3 py-2 text-right">{Number(item.bookQty).toLocaleString()} {item.material?.unit}</td>
                        <td className="px-3 py-2 text-right">
                          {detail.status === "DRAFT" && canEdit ? (
                            <input
                              type="number"
                              value={actualStr}
                              onChange={(e) => updateDetailItem(idx, "actualQty", e.target.value)}
                              className="w-24 px-2 py-1 border border-gray-300 rounded text-sm text-right"
                            />
                          ) : (
                            actualStr ? `${Number(actualStr).toLocaleString()} ${item.material?.unit}` : "-"
                          )}
                        </td>
                        <td className={`px-3 py-2 text-right font-medium ${
                          diff !== null && diff > 0 ? "text-green-600" :
                          diff !== null && diff < 0 ? "text-red-600" : "text-gray-500"
                        }`}>
                          {diff !== null ? (diff > 0 ? `+${diff}` : String(diff)) : "-"}
                        </td>
                        <td className="px-3 py-2">
                          {detail.status === "DRAFT" && canEdit ? (
                            <input
                              value={item.reason || ""}
                              onChange={(e) => updateDetailItem(idx, "reason", e.target.value)}
                              className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                              placeholder="差异原因"
                            />
                          ) : (
                            item.reason || "-"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setDetailId(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">关闭</button>
              {detail.status === "DRAFT" && canEdit && (
                <button onClick={() => handleSubmitDone(detail.id)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800">
                  <CheckCircle className="w-4 h-4" />提交盘点
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
