"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Ban, Pencil, Plus, Search } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { SurfaceCard } from "@/components/ui/surface-card";

const emptyForm = {
  name: "",
  contactName: "",
  phone: "",
  wechat: "",
  email: "",
  address: "",
  mainCategory: "",
  remark: "",
};

export default function SuppliersPage() {
  const { data: session } = useSession();
  const canEdit = (session?.user as any)?.role === "SUPER_ADMIN" || (session?.user as any)?.role === "PURCHASE";
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const loadSuppliers = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    const res = await fetch(`/api/erp/suppliers?${params.toString()}`);
    const data = await res.json();
    setSuppliers(data.items || []);
    setLoading(false);
  };

  useEffect(() => {
    const timer = window.setTimeout(loadSuppliers, 200);
    return () => window.clearTimeout(timer);
  }, [search]);

  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm);
    setMessage("");
    setShowModal(true);
  };

  const openEdit = (supplier: any) => {
    setEditId(supplier.id);
    setForm({
      name: supplier.name || "",
      contactName: supplier.contactName || "",
      phone: supplier.phone || "",
      wechat: supplier.wechat || "",
      email: supplier.email || "",
      address: supplier.address || "",
      mainCategory: supplier.mainCategory || "",
      remark: supplier.remark || "",
    });
    setMessage("");
    setShowModal(true);
  };

  const saveSupplier = async () => {
    if (!form.name.trim() || (!editId && (!form.contactName.trim() || !form.phone.trim()))) {
      setMessage("供应商名称、联系人和联系电话均为必填项");
      return;
    }
    setSaving(true);
    setMessage("");
    const res = await fetch(editId ? `/api/erp/suppliers/${editId}` : "/api/erp/suppliers", {
      method: editId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setMessage(data.error || "保存供应商失败");
      return;
    }
    setShowModal(false);
    await loadSuppliers();
  };

  const disableSupplier = async (supplier: any) => {
    if (!confirm(`确定停用供应商“${supplier.name}”吗？已关联的历史物料和采购订单不会被删除。`)) return;
    const res = await fetch(`/api/erp/suppliers/${supplier.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "停用供应商失败");
      return;
    }
    await loadSuppliers();
  };

  return (
    <PageContainer variant="data" className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">供应商管理</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">停用仅关闭使用资格，历史数据会保留。</p>
        </div>
        {canEdit && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />新增供应商
          </Button>
        )}
      </div>

      <SurfaceCard className="flex flex-wrap gap-3 p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称、联系人、电话或主营品类" className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-orange)]" />
        </div>
      </SurfaceCard>

      {message && <SurfaceCard className="p-1"><ErrorState message={message} /></SurfaceCard>}

      {loading ? (
        <SurfaceCard className="p-5"><LoadingSkeleton lines={6} /></SurfaceCard>
      ) : suppliers.length === 0 ? (
        <SurfaceCard><EmptyState title="暂无供应商" /></SurfaceCard>
      ) : (
        <SurfaceCard className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="sticky top-0 border-b border-[var(--border)] bg-[var(--surface-muted)]">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-secondary)]">供应商名称</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-secondary)]">联系人</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-secondary)]">电话 / 微信</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-secondary)]">主营品类</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-secondary)]">状态</th>
                {canEdit && <th className="px-4 py-3 text-center font-medium text-[var(--text-secondary)]">操作</th>}
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id} className="h-12 border-b border-[var(--border)] hover:bg-[var(--surface-hover)]">
                  <td className="px-4 py-3 font-medium text-[var(--text-primary)]">{supplier.name}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{supplier.contactName || "-"}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{supplier.phone || supplier.wechat || "-"}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{supplier.mainCategory || "-"}</td>
                  <td className="px-4 py-3"><StatusBadge status={supplier.isActive ? "启用" : "已停用"} /></td>
                  {canEdit && (
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Button title="编辑供应商" variant="ghost" size="compact" onClick={() => openEdit(supplier)}><Pencil className="h-4 w-4" /></Button>
                        {supplier.isActive && <Button title="停用供应商" variant="danger" size="compact" onClick={() => disableSupplier(supplier)}><Ban className="h-4 w-4" /></Button>}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </SurfaceCard>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowModal(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[var(--radius-lg)] bg-[var(--surface-solid)] p-6 shadow-[var(--shadow-float)]" onClick={(event) => event.stopPropagation()}>
            <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">{editId ? "编辑供应商" : "新增供应商"}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="供应商名称 *" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
              <Field label={`联系人${editId ? "" : " *"}`} value={form.contactName} onChange={(value) => setForm({ ...form, contactName: value })} required={!editId} />
              <Field label={`联系电话${editId ? "" : " *"}`} value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} required={!editId} />
              <Field label="微信" value={form.wechat} onChange={(value) => setForm({ ...form, wechat: value })} />
              <Field label="邮箱" value={form.email} onChange={(value) => setForm({ ...form, email: value })} />
              <Field label="主营品类" value={form.mainCategory} onChange={(value) => setForm({ ...form, mainCategory: value })} />
              <div className="sm:col-span-2"><Field label="地址" value={form.address} onChange={(value) => setForm({ ...form, address: value })} /></div>
              <div className="sm:col-span-2"><Field label="备注" value={form.remark} onChange={(value) => setForm({ ...form, remark: value })} multiline /></div>
            </div>
            {message && <p className="mt-3 text-sm text-[var(--danger)]">{message}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setShowModal(false)} variant="outline">取消</Button>
              <Button onClick={saveSupplier} disabled={saving || !form.name.trim() || (!editId && (!form.contactName.trim() || !form.phone.trim()))}>{saving ? "保存中..." : "保存"}</Button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

function Field({ label, value, onChange, multiline = false, required = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; required?: boolean }) {
  return <label className="block text-xs font-medium text-[var(--text-secondary)]"><span className="mb-1 block">{label}</span>{multiline ? <textarea required={required} value={value} onChange={(event) => onChange(event.target.value)} rows={3} className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-orange)]" /> : <input required={required} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-solid)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-orange)]" />}</label>;
}
