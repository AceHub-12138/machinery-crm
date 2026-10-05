"use client";

import { useCallback, useEffect, useState } from "react";
import { PageContainer } from "@/components/layout/page-container";

/**
 * 平台管理 → Agent 管理：Agent 账号 + 模型/API Key 快捷配置。
 * 交互约定：表单用"展开式卡片"（与配置中心一致，不引入弹窗组件）；
 * 所有写操作走 /api/admin/agent-* 接口，后端仅超管可改并写操作日志。
 */

type AgentAccount = {
  id: string;
  username: string;
  displayName: string;
  remark: string | null;
  dailyQuota: number;
  isActive: boolean;
  createdAt: string;
};

type ModelConfig = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKeyHint: string;
  isActive: boolean;
  createdAt: string;
};

const cardClass = "rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-4 shadow-[var(--shadow-card)]";
const primaryButtonClass = "rounded-[var(--radius-md)] bg-[var(--brand-orange)] px-4 py-2 text-sm text-white hover:bg-[var(--brand-orange-hover)] disabled:opacity-50";
const secondaryButtonClass = "rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50";
const inputClass = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#EE7D2C] focus:ring-2 focus:ring-[#EE7D2C]/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

export function AdminAgentManager() {
  const [tab, setTab] = useState<"accounts" | "model" | "external">("accounts");

  return (
    <PageContainer variant="data" className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Agent 管理</h1>
        <p className="text-sm text-gray-500">
          管理 Agent 平台（小川）的独立使用账号与模型服务配置；账号与 CRM 用户相互独立，只能登录 Agent 平台对话。
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab("accounts")}
          className={tab === "accounts" ? secondaryButtonClass + " border-[#EE7D2C] text-[#b3591a] dark:text-orange-300" : secondaryButtonClass}
        >
          Agent 账号
        </button>
        <button
          type="button"
          onClick={() => setTab("model")}
          className={tab === "model" ? secondaryButtonClass + " border-[#EE7D2C] text-[#b3591a] dark:text-orange-300" : secondaryButtonClass}
        >
          模型与 API Key
        </button>
        <button
          type="button"
          onClick={() => setTab("external")}
          className={tab === "external" ? secondaryButtonClass + " border-[#EE7D2C] text-[#b3591a] dark:text-orange-300" : secondaryButtonClass}
        >
          外部 MCP
        </button>
      </div>

      {tab === "accounts" ? <AccountsTab /> : tab === "model" ? <ModelTab /> : <ExternalMcpTab />}
    </PageContainer>
  );
}

/* ==================== Agent 账号 ==================== */

function AccountsTab() {
  const [accounts, setAccounts] = useState<AgentAccount[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/agent-accounts", { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error || "账号列表加载失败");
        return;
      }
      setAccounts(Array.isArray(data) ? data : []);
    } catch {
      setError("账号列表加载失败");
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  function flash(message: string) {
    setNotice(message);
    setError("");
    window.setTimeout(() => setNotice(""), 3000);
  }

  async function toggleActive(account: AgentAccount) {
    const response = await fetch(`/api/admin/agent-accounts/${account.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: !account.isActive }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setError(data?.error || "操作失败");
      return;
    }
    flash(account.isActive ? `已停用 ${account.displayName}` : `已启用 ${account.displayName}`);
    void reload();
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-emerald-600">{notice}</p>}

      <div className={cardClass}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">Agent 使用账号</h2>
            <p className="mt-1 text-sm text-gray-500">
              仅能登录 Agent 平台对话（默认每天 50 问），无法访问 CRM/ERP 任何业务数据。删除采用停用制，历史记录保留。
            </p>
          </div>
          <button type="button" onClick={() => { setCreating((value) => !value); setEditingId(null); }} className={primaryButtonClass}>
            {creating ? "收起新增" : "新增账号"}
          </button>
        </div>

        {creating && (
          <AccountForm
            onDone={(message) => { setCreating(false); flash(message); void reload(); }}
            onCancel={() => setCreating(false)}
          />
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-[var(--surface-muted)]">
              <tr className="text-left text-gray-500">
                <th className="px-3 py-2">账号</th>
                <th className="px-3 py-2">姓名</th>
                <th className="px-3 py-2">备注</th>
                <th className="px-3 py-2">每日上限</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">创建时间</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">还没有 Agent 账号，点右上角「新增账号」创建第一个</td></tr>
              )}
              {accounts.map((account) => (
                <tr key={account.id} className="h-12 border-t border-[var(--border)] hover:bg-[var(--surface-hover)]">
                  <td className="px-3 py-2 font-mono text-xs">{account.username}</td>
                  <td className="px-3 py-2">{account.displayName}</td>
                  <td className="px-3 py-2 text-gray-500">{account.remark || "—"}</td>
                  <td className="px-3 py-2">{account.dailyQuota} 问/天</td>
                  <td className="px-3 py-2">
                    <span className={account.isActive
                      ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"
                      : "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-zinc-800 dark:text-zinc-400"}
                    >
                      {account.isActive ? "启用中" : "已停用"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-500">{new Date(account.createdAt).toLocaleDateString("zh-CN")}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => { setEditingId(editingId === account.id ? null : account.id); setCreating(false); }} className={secondaryButtonClass}>
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleActive(account)}
                        className={account.isActive
                          ? "rounded-[var(--radius-md)] border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10"
                          : secondaryButtonClass}
                      >
                        {account.isActive ? "停用" : "启用"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editingId && (
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <AccountForm
              account={accounts.find((item) => item.id === editingId)}
              onDone={(message) => { setEditingId(null); flash(message); void reload(); }}
              onCancel={() => setEditingId(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function AccountForm({ account, onDone, onCancel }: {
  account?: AgentAccount;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(account);
  const [username, setUsername] = useState(account?.username ?? "");
  const [displayName, setDisplayName] = useState(account?.displayName ?? "");
  const [remark, setRemark] = useState(account?.remark ?? "");
  const [dailyQuota, setDailyQuota] = useState(String(account?.dailyQuota ?? 50));
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = isEdit
        ? await fetch(`/api/admin/agent-accounts/${account!.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              displayName,
              remark,
              dailyQuota: Number(dailyQuota),
              ...(password ? { password } : {}),
            }),
          })
        : await fetch("/api/admin/agent-accounts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ username, displayName, remark, dailyQuota: Number(dailyQuota), password }),
          });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error || "保存失败");
        return;
      }
      onDone(isEdit ? "账号已更新" : "账号已创建");
    } catch {
      setError("网络中断，保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 rounded-lg border border-[var(--border)] p-4 md:grid-cols-2">
      <label className="text-sm">
        账号（登录用）
        <input value={username} onChange={(event) => setUsername(event.target.value)} disabled={isEdit} required
          className={inputClass + " mt-1" + (isEdit ? " opacity-60" : "")} placeholder="例如：xiaochuan-user01" />
      </label>
      <label className="text-sm">
        姓名
        <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required
          className={inputClass + " mt-1"} placeholder="例如：合作方张三" />
      </label>
      <label className="text-sm">
        {isEdit ? "重置密码（留空=不修改）" : "初始密码（至少 8 位）"}
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password"
          required={!isEdit} className={inputClass + " mt-1"} placeholder={isEdit ? "留空表示不修改密码" : "至少 8 位"} />
      </label>
      <label className="text-sm">
        每日提问上限
        <input type="number" min={1} max={10000} value={dailyQuota} onChange={(event) => setDailyQuota(event.target.value)}
          className={inputClass + " mt-1"} />
      </label>
      <label className="text-sm md:col-span-2">
        备注（可选）
        <input value={remark ?? ""} onChange={(event) => setRemark(event.target.value)}
          className={inputClass + " mt-1"} placeholder="例如：给代理商试用，2026 年底到期" />
      </label>
      {error && <p className="text-sm text-red-600 md:col-span-2">{error}</p>}
      <div className="flex gap-2 md:col-span-2">
        <button type="submit" disabled={saving} className={primaryButtonClass}>{saving ? "保存中..." : "保存"}</button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>取消</button>
      </div>
    </form>
  );
}

/* ==================== 模型与 API Key ==================== */

function ModelTab() {
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/agent-model-configs", { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error || "配置列表加载失败");
        return;
      }
      setConfigs(Array.isArray(data) ? data : []);
    } catch {
      setError("配置列表加载失败");
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  function flash(message: string) {
    setNotice(message);
    setError("");
    window.setTimeout(() => setNotice(""), 3000);
  }

  async function activate(config: ModelConfig) {
    const response = await fetch(`/api/admin/agent-model-configs/${config.id}/activate`, { method: "POST" });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setError(data?.error || "切换失败");
      return;
    }
    flash(`已切换生效配置：${config.name}（即时生效，无需重新部署）`);
    void reload();
  }

  async function remove(config: ModelConfig) {
    if (!window.confirm(`确定删除配置「${config.name}」？该操作会写入操作日志。`)) return;
    const response = await fetch(`/api/admin/agent-model-configs/${config.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setError(data?.error || "删除失败");
      return;
    }
    flash("配置已删除");
    void reload();
  }

  const activeConfig = configs.find((config) => config.isActive);

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-emerald-600">{notice}</p>}

      <div className={cardClass}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">模型服务配置</h2>
            <p className="mt-1 text-sm text-gray-500">
              可保存多套（硅基流动 / 中转站 / 官方 API），一键切换生效，改完即时生效无需重新部署；
              环境变量中的配置始终作为兜底。API Key 加密存储，页面只显示尾四位。
            </p>
          </div>
          <button type="button" onClick={() => { setCreating((value) => !value); setEditingId(null); }} className={primaryButtonClass}>
            {creating ? "收起新增" : "新增配置"}
          </button>
        </div>

        {activeConfig ? (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm dark:border-emerald-500/20 dark:bg-emerald-500/10">
            <span className="mr-2 rounded-full bg-emerald-600 px-2 py-0.5 text-xs text-white">当前生效</span>
            <strong>{activeConfig.name}</strong>
            <span className="ml-2 text-gray-500 dark:text-zinc-400">
              {activeConfig.baseUrl} · {activeConfig.model} · Key {activeConfig.apiKeyHint}
            </span>
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
            当前没有生效的数据库配置，小川正使用环境变量（.env）中的模型配置运行。
          </p>
        )}

        {creating && (
          <ConfigForm
            onDone={(message) => { setCreating(false); flash(message); void reload(); }}
            onCancel={() => setCreating(false)}
          />
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-[var(--surface-muted)]">
              <tr className="text-left text-gray-500">
                <th className="px-3 py-2">名称</th>
                <th className="px-3 py-2">接口地址</th>
                <th className="px-3 py-2">模型</th>
                <th className="px-3 py-2">API Key</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {configs.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">还没有保存过配置；不配置也能用（走 .env 兜底）</td></tr>
              )}
              {configs.map((config) => (
                <tr key={config.id} className="h-12 border-t border-[var(--border)] hover:bg-[var(--surface-hover)]">
                  <td className="px-3 py-2">{config.name}</td>
                  <td className="max-w-56 truncate px-3 py-2 font-mono text-xs text-gray-500">{config.baseUrl}</td>
                  <td className="px-3 py-2 font-mono text-xs">{config.model}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500">{config.apiKeyHint}</td>
                  <td className="px-3 py-2">
                    {config.isActive ? (
                      <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs text-white">生效中</span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-zinc-800 dark:text-zinc-400">备用</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      {!config.isActive && (
                        <button type="button" onClick={() => void activate(config)} className={secondaryButtonClass}>设为生效</button>
                      )}
                      <button type="button" onClick={() => { setEditingId(editingId === config.id ? null : config.id); setCreating(false); }} className={secondaryButtonClass}>
                        编辑
                      </button>
                      {!config.isActive && (
                        <button type="button" onClick={() => void remove(config)}
                          className="rounded-[var(--radius-md)] border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10">
                          删除
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editingId && (
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <ConfigForm
              config={configs.find((item) => item.id === editingId)}
              onDone={(message) => { setEditingId(null); flash(message); void reload(); }}
              onCancel={() => setEditingId(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ConfigForm({ config, onDone, onCancel }: {
  config?: ModelConfig;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(config);
  const [name, setName] = useState(config?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? "https://api.siliconflow.cn/v1");
  const [model, setModel] = useState(config?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState("");

  async function runTest() {
    setTesting(true);
    setTestResult("");
    setError("");
    try {
      // 编辑时 Key 留空 → 复用已保存密钥，但测试当前表单里的地址和模型。
      const useStoredKey = isEdit && !apiKey;
      const response = await fetch("/api/admin/agent-model-configs/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(useStoredKey
          ? { id: config!.id, baseUrl, model }
          : { baseUrl, model, apiKey }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; message?: string; error?: string } | null;
      setTestResult(data?.message || data?.error || (response.ok ? "连接成功" : "连接失败"));
    } catch {
      setTestResult("网络中断，测试失败");
    } finally {
      setTesting(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = isEdit
        ? await fetch(`/api/admin/agent-model-configs/${config!.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, baseUrl, model, ...(apiKey ? { apiKey } : {}) }),
          })
        : await fetch("/api/admin/agent-model-configs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, baseUrl, model, apiKey }),
          });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error || "保存失败");
        return;
      }
      onDone(isEdit ? "配置已更新" : "配置已保存（尚未生效，点列表里「设为生效」启用）");
    } catch {
      setError("网络中断，保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 rounded-lg border border-[var(--border)] p-4 md:grid-cols-2">
      <label className="text-sm">
        配置名称
        <input value={name} onChange={(event) => setName(event.target.value)} required
          className={inputClass + " mt-1"} placeholder="例如：硅基流动 / 某中转站" />
      </label>
      <label className="text-sm">
        接口地址（OpenAI 兼容，一般以 /v1 结尾）
        <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required
          className={inputClass + " mt-1 font-mono text-xs"} placeholder="https://api.siliconflow.cn/v1" />
      </label>
      <label className="text-sm">
        模型名
        <input value={model} onChange={(event) => setModel(event.target.value)} required
          className={inputClass + " mt-1 font-mono text-xs"} placeholder="例如：Pro/moonshotai/Kimi-K2.6" />
      </label>
      <label className="text-sm">
        API Key {isEdit && <span className="text-gray-400">（留空=保持 {config?.apiKeyHint} 不变）</span>}
        <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off"
          required={!isEdit} className={inputClass + " mt-1 font-mono text-xs"} placeholder={isEdit ? "留空表示不修改" : "sk-..."} />
      </label>
      {testResult && (
        <p className={"text-sm md:col-span-2 " + (testResult === "连接成功" ? "text-emerald-600" : "text-red-600")}>
          测试结果：{testResult}
        </p>
      )}
      {error && <p className="text-sm text-red-600 md:col-span-2">{error}</p>}
      <div className="flex gap-2 md:col-span-2">
        <button type="submit" disabled={saving} className={primaryButtonClass}>{saving ? "保存中..." : "保存"}</button>
        <button type="button" onClick={() => void runTest()} disabled={testing} className={secondaryButtonClass}>
          {testing ? "测试中..." : "测试连接"}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>取消</button>
      </div>
    </form>
  );
}

/* ==================== 外部 MCP（联网搜索/网页读取/天眼查/汇率等） ==================== */

/** 预置模板：内置四款常用服务，点击即预填表单；其余服务上线后用「自定义添加」 */
const EXTERNAL_MCP_PRESETS = [
  { key: "zhipu-search", name: "智谱·联网搜索", url: "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp?Authorization={API_KEY}", requiresKey: true, note: "GLM Coding Plan 会员免费，需智谱开放平台 API Key" },
  { key: "zhipu-reader", name: "智谱·网页读取", url: "https://open.bigmodel.cn/api/mcp/web_reader/mcp?Authorization={API_KEY}", requiresKey: true, note: "GLM Coding Plan 会员免费，需智谱开放平台 API Key" },
  { key: "tianyancha", name: "天眼查", url: "https://mcp.tianyancha.com/mcp", requiresKey: true, note: "需天眼查开放平台 API Key（按次计费）" },
  { key: "exchange-rate", name: "汇率查询", url: "https://currency-mcp.wesbos.com/mcp", requiresKey: false, note: "免费公开服务，无需 API Key" },
] as const;

type ExternalMcpServer = {
  id: string;
  name: string;
  url: string;
  apiKeyHint: string | null;
  isEnabled: boolean;
  createdAt: string;
};

function ExternalMcpTab() {
  const [servers, setServers] = useState<ExternalMcpServer[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preset, setPreset] = useState<string | null>(null); // 正在按模板新增
  const [creatingCustom, setCreatingCustom] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/agent-mcp-servers", { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error || "外部 MCP 列表加载失败");
        return;
      }
      setServers(Array.isArray(data) ? data : []);
    } catch {
      setError("外部 MCP 列表加载失败");
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  function flash(message: string) {
    setNotice(message);
    setError("");
    window.setTimeout(() => setNotice(""), 4000);
  }

  async function toggleEnabled(server: ExternalMcpServer) {
    const response = await fetch(`/api/admin/agent-mcp-servers/${server.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isEnabled: !server.isEnabled }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setError(data?.error || "操作失败");
      return;
    }
    flash(server.isEnabled ? `已停用「${server.name}」，工具下一轮对话起不再下发` : `已启用「${server.name}」，工具即刻生效`);
    void reload();
  }

  async function remove(server: ExternalMcpServer) {
    if (!window.confirm(`确定删除外部 MCP「${server.name}」？`)) return;
    const response = await fetch(`/api/admin/agent-mcp-servers/${server.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setError(data?.error || "删除失败");
      return;
    }
    flash("已删除");
    void reload();
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-emerald-600">{notice}</p>}

      <div className={cardClass}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">外部 MCP 服务</h2>
            <p className="mt-1 text-sm text-gray-500">
              给小川外接联网搜索、网页读取、企业信息、汇率查询等工具；启用后对全员（含 Agent 使用账号）生效。
              外部工具不接触平台业务数据，与业务权限隔离互不影响。
            </p>
          </div>
          <button type="button" onClick={() => { setCreatingCustom((value) => !value); setPreset(null); setEditingId(null); }} className={primaryButtonClass}>
            {creatingCustom ? "收起自定义" : "自定义添加"}
          </button>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs text-gray-500">一键添加预置服务（点选后按提示填 API Key 保存即可）：</p>
          <div className="flex flex-wrap gap-2">
            {EXTERNAL_MCP_PRESETS.map((item) => (
              <button
                key={item.key}
                type="button"
                title={item.note}
                onClick={() => { setPreset(preset === item.key ? null : item.key); setCreatingCustom(false); setEditingId(null); }}
                className={preset === item.key
                  ? secondaryButtonClass + " border-[#EE7D2C] text-[#b3591a] dark:text-orange-300"
                  : secondaryButtonClass}
              >
                + {item.name}
              </button>
            ))}
          </div>
        </div>

        {preset && (
          <div className="mt-3 rounded-lg border border-[#EE7D2C]/40 bg-[#ee7d2c]/5 p-3 text-xs text-gray-500 dark:text-zinc-400">
            {EXTERNAL_MCP_PRESETS.find((item) => item.key === preset)?.note}
          </div>
        )}
        {preset && (
          <ExternalMcpForm
            preset={EXTERNAL_MCP_PRESETS.find((item) => item.key === preset)}
            onDone={(message) => { setPreset(null); flash(message); void reload(); }}
            onCancel={() => setPreset(null)}
          />
        )}
        {creatingCustom && (
          <ExternalMcpForm
            onDone={(message) => { setCreatingCustom(false); flash(message); void reload(); }}
            onCancel={() => setCreatingCustom(false)}
          />
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-[var(--surface-muted)]">
              <tr className="text-left text-gray-500">
                <th className="px-3 py-2">名称</th>
                <th className="px-3 py-2">接口地址</th>
                <th className="px-3 py-2">API Key</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {servers.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">还没有添加外部服务；点上方预置按钮或「自定义添加」开始</td></tr>
              )}
              {servers.map((server) => (
                <tr key={server.id} className="h-12 border-t border-[var(--border)] hover:bg-[var(--surface-hover)]">
                  <td className="px-3 py-2">{server.name}</td>
                  <td className="max-w-64 truncate px-3 py-2 font-mono text-xs text-gray-500">{server.url}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500">{server.apiKeyHint || "无需 Key"}</td>
                  <td className="px-3 py-2">
                    <span className={server.isEnabled
                      ? "rounded-full bg-emerald-600 px-2 py-0.5 text-xs text-white"
                      : "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-zinc-800 dark:text-zinc-400"}
                    >
                      {server.isEnabled ? "已启用" : "已停用"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => void toggleEnabled(server)} className={server.isEnabled ? secondaryButtonClass : primaryButtonClass}>
                        {server.isEnabled ? "停用" : "启用"}
                      </button>
                      <button type="button" onClick={() => { setEditingId(editingId === server.id ? null : server.id); setPreset(null); setCreatingCustom(false); }} className={secondaryButtonClass}>
                        编辑
                      </button>
                      <button type="button" onClick={() => void remove(server)}
                        className="rounded-[var(--radius-md)] border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10">
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editingId && (
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <ExternalMcpForm
              server={servers.find((item) => item.id === editingId)}
              onDone={(message) => { setEditingId(null); flash(message); void reload(); }}
              onCancel={() => setEditingId(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ExternalMcpForm({ server, preset, onDone, onCancel }: {
  server?: ExternalMcpServer;
  preset?: { name: string; url: string; requiresKey: boolean } | null;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(server);
  const [name, setName] = useState(server?.name ?? preset?.name ?? "");
  const [url, setUrl] = useState(server?.url ?? preset?.url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState("");

  async function runTest() {
    setTesting(true);
    setTestResult("");
    setError("");
    try {
      const useStored = isEdit && !apiKey;
      const response = await fetch("/api/admin/agent-mcp-servers/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(useStored ? { id: server!.id, url } : { url, apiKey }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; message?: string; error?: string; tools?: string[] } | null;
      const toolNote = data?.tools?.length ? `：${data.tools.slice(0, 5).join("、")}${data.tools.length > 5 ? " 等" : ""}` : "";
      setTestResult((data?.message || data?.error || (response.ok ? "连接成功" : "连接失败")) + toolNote);
    } catch {
      setTestResult("网络中断，测试失败");
    } finally {
      setTesting(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = isEdit
        ? await fetch(`/api/admin/agent-mcp-servers/${server!.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, url, ...(apiKey ? { apiKey } : {}) }),
          })
        : await fetch("/api/admin/agent-mcp-servers", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, url, apiKey }),
          });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error || "保存失败");
        return;
      }
      onDone(isEdit ? "配置已更新" : "已添加（默认停用，点列表里「启用」让小川用上）");
    } catch {
      setError("网络中断，保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 rounded-lg border border-[var(--border)] p-4 md:grid-cols-2">
      <label className="text-sm">
        服务名称
        <input value={name} onChange={(event) => setName(event.target.value)} required
          className={inputClass + " mt-1"} placeholder="例如：智谱·联网搜索" />
      </label>
      <label className="text-sm">
        服务地址（MCP 端点；可用 {"{API_KEY}"} 占位符）
        <input value={url} onChange={(event) => setUrl(event.target.value)} required
          className={inputClass + " mt-1 font-mono text-xs"} placeholder="https://.../mcp?Authorization={API_KEY}" />
      </label>
      <label className="text-sm md:col-span-2">
        API Key {isEdit && server?.apiKeyHint && <span className="text-gray-400">（留空=保持 {server.apiKeyHint} 不变）</span>}
        <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off"
          required={Boolean(preset?.requiresKey) && !isEdit}
          className={inputClass + " mt-1 font-mono text-xs"}
          placeholder={preset?.requiresKey ? "必填：粘贴服务商提供的 API Key" : "该服务可留空"} />
      </label>
      {testResult && (
        <p className={"text-sm md:col-span-2 " + (testResult.startsWith("连接成功") ? "text-emerald-600" : "text-red-600")}>
          测试结果：{testResult}
        </p>
      )}
      {error && <p className="text-sm text-red-600 md:col-span-2">{error}</p>}
      <div className="flex gap-2 md:col-span-2">
        <button type="submit" disabled={saving} className={primaryButtonClass}>{saving ? "保存中..." : "保存"}</button>
        <button type="button" onClick={() => void runTest()} disabled={testing} className={secondaryButtonClass}>
          {testing ? "测试中..." : "测试连接"}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>取消</button>
      </div>
    </form>
  );
}
