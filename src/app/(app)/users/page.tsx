"use client";

import { useEffect, useMemo, useState } from "react";
import { Edit2, KeyRound, Plus, Trash2, X } from "lucide-react";
import { ROLE_LABELS } from "@/lib/constants";
import { TerritoryPicker, summarizeTerritories, type Territory } from "@/components/common/territory-picker";
import { roleRequiresRegionScope } from "@/lib/erp-roles";
import { PageContainer } from "@/components/layout/page-container";

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: "SUPER_ADMIN" | "SALES" | "FOREIGN_TRADE" | "PURCHASE" | "WAREHOUSE";
  region: string;
  territories?: Territory[];
  viewScope?: string;
  isActive: boolean;
  createdAt: string;
};

const defaultCreateForm = {
  email: "",
  password: "",
  name: "",
  role: "SALES",
  territories: [] as Territory[],
  viewScope: "TERRITORY",
};

const defaultEditForm = {
  name: "",
  role: "SALES",
  territories: [] as Territory[],
  viewScope: "TERRITORY",
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState(defaultCreateForm);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState(defaultEditForm);
  const [resetPasswordUser, setResetPasswordUser] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [transferUser, setTransferUser] = useState<UserRow | null>(null);
  const [transferToUserId, setTransferToUserId] = useState("");
  const [transferMessage, setTransferMessage] = useState("");
  const [showInactiveUsers, setShowInactiveUsers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const receiverOptions = useMemo(
    () => users.filter((item) => item.isActive && item.id !== transferUser?.id),
    [users, transferUser]
  );

  const fetchUsers = () => {
    setLoading(true);
    fetch(`/api/users${showInactiveUsers ? "?includeInactive=1" : ""}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setUsers(data);
        else setError(data.error || "用户列表加载失败");
      })
      .catch(() => setError("用户列表加载失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchUsers();
  }, [showInactiveUsers]);

  const clearMessages = () => {
    setError("");
    setNotice("");
  };

  async function readJson(res: Response) {
    return res.json().catch(() => ({}));
  }

  const handleCreate = async () => {
    if (!createForm.email || !createForm.password || !createForm.name) {
      setError("姓名、账号和密码为必填项");
      return;
    }
    if (createForm.password.length < 8) {
      setError("密码至少需要 8 位");
      return;
    }

    setSaving(true);
    clearMessages();
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(data.error || "创建失败");
        return;
      }
      setShowCreateForm(false);
      setCreateForm(defaultCreateForm);
      setNotice("用户已创建");
      fetchUsers();
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (target: UserRow) => {
    clearMessages();
    setEditingUser(target);
    setEditForm({ name: target.name, role: target.role, territories: target.territories || [], viewScope: target.viewScope || "TERRITORY" });
  };

  const handleEdit = async () => {
    if (!editingUser) return;
    if (!editForm.name.trim()) {
      setError("姓名不能为空");
      return;
    }

    setSaving(true);
    clearMessages();
    try {
      const res = await fetch(`/api/users/${editingUser.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(data.error || "保存失败");
        return;
      }
      setEditingUser(null);
      setNotice("用户资料已更新");
      fetchUsers();
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  };

  const openResetPassword = (target: UserRow) => {
    clearMessages();
    setResetPasswordUser(target);
    setNewPassword("");
  };

  const handleResetPassword = async () => {
    if (!resetPasswordUser) return;
    if (newPassword.length < 8) {
      setError("新密码至少需要 8 位");
      return;
    }

    setSaving(true);
    clearMessages();
    try {
      const res = await fetch(`/api/users/${resetPasswordUser.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(data.error || "重置密码失败");
        return;
      }
      setResetPasswordUser(null);
      setNewPassword("");
      setNotice("密码已重置");
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (target: UserRow) => {
    setSaving(true);
    clearMessages();
    try {
      const res = await fetch(`/api/users/${target.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !target.isActive }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(data.error || "操作失败");
        return;
      }
      setNotice(target.isActive ? "用户已禁用" : "用户已启用");
      fetchUsers();
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async (target: UserRow) => {
    const confirmed = window.confirm(`确认清理账号“${target.email}”吗？系统不会物理删除账号，会根据数据情况禁用或转移后禁用。`);
    if (!confirmed) return;

    setSaving(true);
    clearMessages();
    try {
      const res = await fetch(`/api/users/${target.id}`, { method: "DELETE" });
      const data = await readJson(res);
      if (res.status === 409 && data.requiresTransfer) {
        setTransferUser(target);
        setTransferMessage(data.error || "该账号已有业务数据，请选择接收账号。");
        setTransferToUserId("");
        return;
      }
      if (!res.ok) {
        setError(data.error || "账号清理失败");
        return;
      }
      setNotice(`${data.message || "账号已禁用"}，已从当前用户列表隐藏`);
      fetchUsers();
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  };

  const confirmTransferAndDisable = async () => {
    if (!transferUser) return;
    if (!transferToUserId) {
      setError("请选择接收账号");
      return;
    }

    setSaving(true);
    clearMessages();
    try {
      const res = await fetch(`/api/users/${transferUser.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transferToUserId }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(data.error || "数据转移失败");
        return;
      }
      setTransferUser(null);
      setTransferToUserId("");
      setNotice(`${data.message || "账号数据已转移，原账号已禁用"}，已从当前用户列表隐藏`);
      fetchUsers();
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageContainer variant="data" className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-gray-900">用户管理</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              clearMessages();
              setShowInactiveUsers((value) => !value);
            }}
            className={`px-3 py-2 text-sm rounded-lg border ${showInactiveUsers ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}
          >
            {showInactiveUsers ? "隐藏已禁用" : "显示已禁用"}
          </button>
          <button
            onClick={() => {
              clearMessages();
              setShowCreateForm(!showCreateForm);
            }}
            className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--brand-orange)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-orange-hover)]"
          >
            {showCreateForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showCreateForm ? "收起" : "新增用户"}
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{notice}</div>}

      {showCreateForm && (
        <div className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-5 shadow-[var(--shadow-card)]">
          <h2 className="text-sm font-semibold text-gray-700">新增用户</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <FormInput label="姓名 *" value={createForm.name} onChange={(value) => setCreateForm({ ...createForm, name: value })} />
            <FormInput label="账号 *" value={createForm.email} onChange={(value) => setCreateForm({ ...createForm, email: value })} />
            <FormInput label="密码 *" type="password" value={createForm.password} onChange={(value) => setCreateForm({ ...createForm, password: value })} />
            <RoleSelect value={createForm.role} onChange={(value) => setCreateForm({ ...createForm, role: value, territories: [], viewScope: value === "SUPER_ADMIN" ? "ALL" : "TERRITORY" })} />
          </div>
          {roleRequiresRegionScope(createForm.role) && <TerritoryField
            territories={createForm.territories}
            viewScope={createForm.viewScope}
            onTerritories={(t) => setCreateForm({ ...createForm, territories: t })}
            onViewScope={(v) => setCreateForm({ ...createForm, viewScope: v })}
          />}
          <div className="flex flex-wrap gap-3">
            <button onClick={handleCreate} disabled={saving} className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50">
              {saving ? "创建中..." : "创建用户"}
            </button>
            <button onClick={() => setShowCreateForm(false)} className="px-4 py-2 bg-white text-gray-700 text-sm rounded-lg border border-gray-300 hover:bg-gray-50">取消</button>
          </div>
        </div>
      )}

      {editingUser && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">编辑账号：{editingUser.email}</h2>
            <button onClick={() => setEditingUser(null)} className="p-1.5 text-gray-400 hover:text-gray-600" title="关闭"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <FormInput label="姓名 *" value={editForm.name} onChange={(value) => setEditForm({ ...editForm, name: value })} />
            <RoleSelect value={editForm.role} onChange={(value) => setEditForm({ ...editForm, role: value, territories: [], viewScope: value === "SUPER_ADMIN" ? "ALL" : "TERRITORY" })} />
          </div>
          {roleRequiresRegionScope(editForm.role) && <TerritoryField
            territories={editForm.territories}
            viewScope={editForm.viewScope}
            onTerritories={(t) => setEditForm({ ...editForm, territories: t })}
            onViewScope={(v) => setEditForm({ ...editForm, viewScope: v })}
          />}
          <div className="flex flex-wrap gap-3">
            <button onClick={handleEdit} disabled={saving} className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50">
              {saving ? "保存中..." : "保存修改"}
            </button>
            <button onClick={() => setEditingUser(null)} className="px-4 py-2 bg-white text-gray-700 text-sm rounded-lg border border-gray-300 hover:bg-gray-50">取消</button>
          </div>
        </div>
      )}

      {resetPasswordUser && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">重置密码：{resetPasswordUser.email}</h2>
            <button onClick={() => setResetPasswordUser(null)} className="p-1.5 text-gray-400 hover:text-gray-600" title="关闭"><X className="w-4 h-4" /></button>
          </div>
          <div className="max-w-sm">
            <FormInput label="新密码，至少 8 位 *" type="password" value={newPassword} onChange={setNewPassword} />
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={handleResetPassword} disabled={saving} className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50">
              {saving ? "重置中..." : "确认重置"}
            </button>
            <button onClick={() => setResetPasswordUser(null)} className="px-4 py-2 bg-white text-gray-700 text-sm rounded-lg border border-gray-300 hover:bg-gray-50">取消</button>
          </div>
        </div>
      )}

      {transferUser && (
        <div className="bg-white rounded-xl border border-amber-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">删除账号前转移数据</h2>
            <button onClick={() => setTransferUser(null)} className="p-1.5 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            {transferMessage || "该账号名下已有客户、合同、发货或跟进记录。删除该账号前，请选择一个接收账号，系统会将该账号名下数据转移到接收账号。"}
          </p>
          <div className="max-w-md">
            <label className="block text-xs font-medium text-gray-600 mb-1">接收账号 *</label>
            <select
              value={transferToUserId}
              onChange={(event) => setTransferToUserId(event.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            >
              <option value="">请选择启用状态账号</option>
              {receiverOptions.map((item) => (
                <option key={item.id} value={item.id}>{item.name}（{item.email}）</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={confirmTransferAndDisable} disabled={saving} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50">
              {saving ? "处理中..." : "转移并禁用"}
            </button>
            <button onClick={() => setTransferUser(null)} className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50">取消</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] shadow-[var(--shadow-card)]">
        <table className="w-full min-w-[980px] table-fixed">
          <thead className="sticky top-0 bg-[var(--surface-muted)] border-b border-[var(--border)]">
            <tr>
              <th className="w-[120px] text-left px-4 py-3 text-xs font-medium text-gray-500">姓名</th>
              <th className="w-[220px] text-left px-4 py-3 text-xs font-medium text-gray-500">账号</th>
              <th className="w-[110px] text-left px-4 py-3 text-xs font-medium text-gray-500">角色</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">负责范围</th>
              <th className="w-[80px] whitespace-nowrap text-left px-4 py-3 text-xs font-medium text-gray-500">状态</th>
              <th className="w-[220px] whitespace-nowrap text-left px-4 py-3 text-xs font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={6} className="text-center py-8 text-sm text-gray-500">加载中...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-sm text-gray-500">暂无用户</td></tr>
            ) : (
              users.map((target) => (
                <tr key={target.id} className="h-12 hover:bg-[var(--surface-hover)]">
                  <td className="truncate px-4 py-3 text-sm font-medium text-gray-900">{target.name}</td>
                  <td className="truncate px-4 py-3 text-sm text-gray-600">{target.email}</td>
                  <td className="whitespace-nowrap px-4 py-3"><span className="whitespace-nowrap text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{ROLE_LABELS[target.role]}</span></td>
                  <td className="truncate px-4 py-3 text-sm text-gray-600" title={regionScopeTitle(target)}>{compactRegionScope(target)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={`whitespace-nowrap text-xs px-2 py-0.5 rounded-full ${target.isActive ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                      {target.isActive ? "启用" : "禁用"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-nowrap items-center gap-3 whitespace-nowrap">
                      <button onClick={() => openEdit(target)} className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"><Edit2 className="w-3.5 h-3.5" />编辑</button>
                      <button onClick={() => openResetPassword(target)} className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"><KeyRound className="w-3.5 h-3.5" />重置密码</button>
                      <button onClick={() => toggleActive(target)} disabled={saving} className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50">{target.isActive ? "禁用" : "启用"}</button>
                      <button onClick={() => deleteUser(target)} disabled={saving} className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" />删除</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageContainer>
  );
}

function FormInput({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
    </div>
  );
}

function RoleSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">角色 *</label>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
        <option value="SALES">销售</option>
        <option value="FOREIGN_TRADE">外贸业务</option>
        <option value="SUPER_ADMIN">超级管理员</option>
        <option value="PURCHASE">采购</option>
        <option value="WAREHOUSE">仓库管理</option>
      </select>
    </div>
  );
}

function regionScopeTitle(user: UserRow) {
  return roleRequiresRegionScope(user.role) ? summarizeTerritories(user.territories, user.viewScope) : "—";
}

function compactRegionScope(user: UserRow) {
  if (!roleRequiresRegionScope(user.role)) return "—";
  if (user.viewScope === "ALL") return "全区域";
  const areas = (user.territories || []).flatMap((territory) =>
    territory.cities?.length ? territory.cities.map((city) => `${territory.province}${city}`) : [territory.province]
  );
  if (areas.length === 0) return "未分配";
  return areas.length > 3 ? `${areas.slice(0, 3).join("、")} 等 ${areas.length} 个地区` : areas.join("、");
}

function TerritoryField({
  territories,
  viewScope,
  onTerritories,
  onViewScope,
}: {
  territories: Territory[];
  viewScope: string;
  onTerritories: (t: Territory[]) => void;
  onViewScope: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">负责范围 *</label>
      <TerritoryPicker value={territories} onChange={(next) => { onViewScope("TERRITORY"); onTerritories(next); }} />
      {viewScope !== "ALL" && territories.length === 0 && (
        <p className="mt-1 text-[11px] text-amber-600">销售和外贸销售必须选择至少一个负责省市</p>
      )}
    </div>
  );
}
