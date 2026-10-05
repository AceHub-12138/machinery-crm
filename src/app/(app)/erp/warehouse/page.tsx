"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Plus, Pencil, Trash2, Warehouse } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";

export default function WarehousePage() {
  const { data: session } = useSession();
  const userRole = (session?.user as any)?.role;
  const canEdit = userRole === "SUPER_ADMIN" || userRole === "WAREHOUSE";

  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", code: "", address: "" });
  const [saving, setSaving] = useState(false);

  const loadWarehouses = () => {
    setLoading(true);
    fetch("/api/erp/warehouses")
      .then((r) => r.json())
      .then((data) => setWarehouses(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadWarehouses();
  }, []);

  const openCreate = () => {
    setEditId(null);
    setForm({ name: "", code: "", address: "" });
    setShowModal(true);
  };

  const openEdit = (w: any) => {
    setEditId(w.id);
    setForm({ name: w.name, code: w.code, address: w.address || "" });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.code) return;
    setSaving(true);
    const url = editId ? `/api/erp/warehouses/${editId}` : "/api/erp/warehouses";
    const method = editId ? "PUT" : "POST";
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    setShowModal(false);
    loadWarehouses();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定停用该仓库？")) return;
    await fetch(`/api/erp/warehouses/${id}`, { method: "DELETE" });
    loadWarehouses();
  };

  return (
    <PageContainer variant="data" className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-gray-900">仓库设置</h1>
        {canEdit && (
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--brand-orange)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-orange-hover)]"
          >
            <Plus className="w-4 h-4" />新增仓库
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-center py-8 text-sm text-gray-500">加载中...</p>
      ) : warehouses.length === 0 ? (
        <p className="text-center py-8 text-sm text-gray-500">暂无仓库</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {warehouses.map((w) => (
            <div key={w.id} className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-5 shadow-[var(--shadow-card)] hover:bg-[var(--surface-hover)]">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                  <Warehouse className="w-5 h-5 text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-900 truncate">{w.name}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${w.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {w.isActive ? "启用" : "停用"}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 font-mono">编码：{w.code}</p>
                  {w.address && <p className="text-xs text-gray-400 mt-1 truncate">{w.address}</p>}
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-gray-500">{w._count?.inventories ?? 0} 种物料</span>
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(w)} className="text-gray-400 hover:text-gray-700">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(w.id)} className="text-gray-400 hover:text-red-600">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">{editId ? "编辑仓库" : "新增仓库"}</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">仓库名称 *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">仓库编码 *</label>
                <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">地址</label>
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">取消</button>
              <button onClick={handleSave} disabled={saving || !form.name || !form.code}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">{saving ? "保存中..." : "保存"}</button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
