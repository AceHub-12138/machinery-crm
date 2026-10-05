"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { FileDown, Plus, Search, Pencil, Trash2, SlidersHorizontal, Upload } from "lucide-react";
import { MaterialImportDialog, downloadMaterialImportTemplate } from "@/components/erp/material-import-dialog";
import { PageContainer } from "@/components/layout/page-container";

const UNIT_OPTIONS = ["件", "个", "套", "kg", "米", "升", "箱", "包", "桶"];

function flattenCategories(cats: any[], depth = 0): { id: string; label: string; warningThreshold?: any }[] {
  const result: { id: string; label: string; warningThreshold?: any }[] = [];
  for (const cat of cats) {
    result.push({ id: cat.id, label: "  ".repeat(depth) + cat.name, warningThreshold: cat.warningThreshold });
    if (cat.children) {
      result.push(...flattenCategories(cat.children, depth + 1));
    }
  }
  return result;
}

export default function MaterialsPage() {
  const { data: session } = useSession();
  const userRole = (session?.user as any)?.role;

  const [materials, setMaterials] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<any>({ code: "", name: "", categoryId: "", spec: "", unit: "件", standardPrice: "", safetyStock: "", minStock: "", maxStock: "", procurementLeadDays: "0", safetyStockEnabled: false, autoPurchaseDraftEnabled: false, supplier: "", supplierId: "", remark: "" });
  const [thresholdDraft, setThresholdDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [savingThresholds, setSavingThresholds] = useState(false);

  const canEdit = userRole === "SUPER_ADMIN" || userRole === "WAREHOUSE";
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));

  const loadCategories = async () => {
    const res = await fetch("/api/erp/material-categories");
    const data = await res.json();
    const next = Array.isArray(data) ? data : [];
    setCategories(next);
    const flat = flattenCategories(next);
    setThresholdDraft(
      Object.fromEntries(
        flat.map((cat) => [cat.id, cat.warningThreshold !== null && cat.warningThreshold !== undefined ? String(cat.warningThreshold) : ""])
      )
    );
  };

  useEffect(() => {
    loadCategories();
    fetch("/api/erp/suppliers")
      .then((res) => res.json())
      .then((data) => setSuppliers(data.items || []));
  }, []);

  const loadMaterials = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (categoryId) params.set("categoryId", categoryId);
    const res = await fetch(`/api/erp/materials?${params.toString()}`);
    const data = await res.json();
    setMaterials(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [search, categoryId]);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  const openCreate = () => {
    setEditId(null);
    setFormError("");
    setNotice("");
    setForm({ code: "", name: "", categoryId: categories[0]?.id || "", spec: "", unit: "件", standardPrice: "", safetyStock: "", minStock: "", maxStock: "", procurementLeadDays: "0", safetyStockEnabled: false, autoPurchaseDraftEnabled: false, supplier: "", supplierId: "", remark: "" });
    setShowModal(true);
  };

  const openEdit = (m: any) => {
    setEditId(m.id);
    setFormError("");
    setNotice("");
    setForm({
      code: m.code,
      name: m.name,
      categoryId: m.categoryId,
      spec: m.spec || "",
      unit: m.unit || "件",
      standardPrice: m.standardPrice ? String(m.standardPrice) : "",
      safetyStock: m.safetyStock ? String(m.safetyStock) : "",
      minStock: m.minStock ? String(m.minStock) : "",
      maxStock: m.maxStock ? String(m.maxStock) : "",
      procurementLeadDays: String(m.procurementLeadDays || 0),
      safetyStockEnabled: Boolean(m.safetyStockEnabled),
      autoPurchaseDraftEnabled: Boolean(m.autoPurchaseDraftEnabled),
      supplier: m.supplier || "",
      supplierId: m.supplierId || "",
      remark: m.remark || "",
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.code || !form.name || !form.categoryId) return;
    setSaving(true);
    setFormError("");
    const url = editId ? `/api/erp/materials/${editId}` : "/api/erp/materials";
    const method = editId ? "PUT" : "POST";
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setFormError(data?.error || `保存失败（${res.status}）`);
        setSaving(false);
        return;
      }
      setSaving(false);
      if (data?.revived) {
        const stockCount = Number(data.revivedStock || 0);
        setNotice(`编码 ${form.code} 此前用于已删除物料，已自动恢复并按本次填写更新信息${stockCount > 0 ? `（该物料账面原有库存 ${stockCount} ${data.unit || "件"}）` : ""}`);
      } else if (data?.releasedFrom) {
        setNotice(`原占用编码 ${data.releasedFrom} 的已删除记录已自动改名让位（${data.releasedTombCode}），本次修改已保存`);
      }
      setShowModal(false);
      await loadMaterials();
    } catch {
      setFormError("网络错误，请重试");
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除该物料？删除后其编码可重新使用：新增同编码物料会自动恢复这条记录及其历史账目。")) return;
    await fetch(`/api/erp/materials/${id}`, { method: "DELETE" });
    setMaterials((prev) => prev.filter((m) => m.id !== id));
  };

  const handleSaveThresholds = async () => {
    setSavingThresholds(true);
    try {
      const flat = flattenCategories(categories);
      await Promise.all(
        flat.map(async (cat) => {
          const res = await fetch(`/api/erp/material-categories/${cat.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ warningThreshold: thresholdDraft[cat.id] ?? "" }),
          });
          if (!res.ok) {
            throw new Error("Failed to save category warning threshold");
          }
        })
      );
      await loadCategories();
      setShowWarningModal(false);
    } finally {
      setSavingThresholds(false);
    }
  };

  return (
    <PageContainer variant="data" className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-gray-900">物料管理</h1>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={downloadMaterialImportTemplate}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
            >
              <FileDown className="w-4 h-4" />下载物料导入模板
            </button>
            <button
              onClick={() => setShowImportModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
            >
              <Upload className="w-4 h-4" />Excel导入物料
            </button>
            <button
              onClick={() => setShowWarningModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
            >
              <SlidersHorizontal className="w-4 h-4" />分类预警设置
            </button>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--brand-orange)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-orange-hover)]"
            >
              <Plus className="w-4 h-4" />新增物料
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-4 shadow-[var(--shadow-card)]">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索物料名称/编码/图号..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
        </div>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        >
          <option value="">全部分类</option>
          {flattenCategories(categories).map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>

      {notice && <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{notice}</p>}

      {loading ? (
        <p className="text-center py-8 text-sm text-gray-500">加载中...</p>
      ) : materials.length === 0 ? (
        <p className="text-center py-8 text-sm text-gray-500">暂无物料</p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] shadow-[var(--shadow-card)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b border-[var(--border)] bg-[var(--surface-muted)]">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">编码</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">名称</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">分类</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">规格</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">供货商</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">标准价</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">安全库存</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">单位</th>
                {canEdit && <th className="text-center px-4 py-3 font-medium text-gray-600">操作</th>}
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => (
                <tr key={m.id} className="h-12 border-b border-[var(--border)] hover:bg-[var(--surface-hover)]">
                  <td className="px-4 py-3 font-mono text-xs">{m.code}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{m.name}</td>
                  <td className="px-4 py-3 text-gray-500">{m.category?.name}</td>
                  <td className="px-4 py-3 text-gray-500">{m.spec || "-"}</td>
                  <td className="px-4 py-3 text-gray-500">{supplierById.get(m.supplierId)?.name || m.supplier || "-"}</td>
                  <td className="px-4 py-3 text-right">{m.standardPrice ? `¥${Number(m.standardPrice).toLocaleString()}` : "-"}</td>
                  <td className="px-4 py-3 text-right">{m.safetyStock ? String(m.safetyStock) : "-"}</td>
                  <td className="px-4 py-3 text-center">{m.unit}</td>
                  {canEdit && (
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => openEdit(m)} className="text-gray-400 hover:text-gray-700">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(m.id)} className="text-gray-400 hover:text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">{editId ? "编辑物料" : "新增物料"}</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">编码 *</label>
                  <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">名称 *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">分类 *</label>
                <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="">请选择</option>
                  {flattenCategories(categories).map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">规格</label>
                  <input value={form.spec} onChange={(e) => setForm({ ...form, spec: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">单位</label>
                  <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">标准价</label>
                  <input type="number" value={form.standardPrice} onChange={(e) => setForm({ ...form, standardPrice: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">安全库存</label>
                  <input type="number" value={form.safetyStock} onChange={(e) => setForm({ ...form, safetyStock: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1">默认采购提前期（天）</label><input type="number" min="0" value={form.procurementLeadDays} onChange={(e) => setForm({ ...form, procurementLeadDays: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.safetyStockEnabled} onChange={(e) => setForm({ ...form, safetyStockEnabled: e.target.checked })} />启用安全库存（参与预警与采购计划）</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.autoPurchaseDraftEnabled} onChange={(e) => setForm({ ...form, autoPurchaseDraftEnabled: e.target.checked })} />允许自动生成采购需求草稿</label>
              </div>
              <p className="text-xs leading-5 text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                预警口径：勾选「启用安全库存」后，库存 ≤ 安全库存即预警，并按安全库存参与采购计划；未勾选时，按「分类预警设置」里的分类预警线预警；安全库存留空或 0 表示不按物料级预警。
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">关联供应商</label>
                <select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="">不关联</option>
                  {suppliers.filter((supplier) => supplier.isActive || supplier.id === form.supplierId).map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>{supplier.name}{supplier.isActive ? "" : "（已停用）"}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">历史手填供货商（兼容旧数据）</label>
                <input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">备注</label>
                <textarea value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
            {formError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg">取消</button>
              <button onClick={handleSave} disabled={saving || !form.code || !form.name || !form.categoryId}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">{saving ? "保存中..." : "保存"}</button>
            </div>
          </div>
        </div>
      )}

      {showWarningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowWarningModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl shadow-xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-semibold">分类预警设置</h2>
                <p className="text-xs text-gray-500 mt-1">某分类库存 ≤ 此数量时预警；留空 = 该分类不预警。物料勾选「启用安全库存」并填写安全库存时，优先按物料值预警。</p>
              </div>
              <button onClick={() => setShowWarningModal(false)} className="text-sm text-gray-500 hover:text-gray-900">关闭</button>
            </div>
            <div className="space-y-2">
              {flattenCategories(categories).map((cat) => (
                <div key={cat.id} className="grid grid-cols-[1fr_160px] gap-3 items-center border border-gray-100 rounded-lg px-3 py-2">
                  <span className="text-sm text-gray-700 whitespace-pre">{cat.label}</span>
                  <input
                    type="number"
                    min="0"
                    value={thresholdDraft[cat.id] ?? ""}
                    onChange={(event) => setThresholdDraft((draft) => ({ ...draft, [cat.id]: event.target.value }))}
                    placeholder="留空不预警"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowWarningModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg">取消</button>
              <button onClick={handleSaveThresholds} disabled={savingThresholds}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
                {savingThresholds ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      <MaterialImportDialog
        open={showImportModal}
        categories={categories}
        onClose={() => setShowImportModal(false)}
        onImported={loadMaterials}
      />
    </PageContainer>
  );
}
