"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DEFAULT_SALES_SCREEN_CONFIG,
  normalizeSalesScreenConfig,
  SALES_SCREEN_SETTING_KEY,
  type SalesScreenConfig,
} from "@/modules/screen/config";

/**
 * 平台管理 → 配置中心：展厅大屏配置卡片。
 * 职责边界：配置保存（/api/system/settings 的 salesScreen 键）与共享链接操作
 * （/api/system/sales-screen/share）完全分离，保存配置不会生成或撤销链接。
 * 权限不在本组件实现：middleware 与服务层已限制 SUPER_ADMIN，这里只透出服务端中文错误。
 */

export type MultiplierField = "amount" | "customerCount" | "contractCount" | "shipmentCount";
export type ModuleField = keyof SalesScreenConfig["modules"];

export type SalesScreenShareView = {
  share: {
    version: 1;
    publicId: string | null;
    createdAt: string | null;
    rotatedAt: string | null;
    revokedAt: string | null;
  };
  path: string | null;
};

export type SalesScreenFormState = {
  enabled: boolean;
  modules: SalesScreenConfig["modules"];
  multiplierText: Record<MultiplierField, string>;
  privacy: SalesScreenConfig["privacy"];
};

const MULTIPLIER_FIELDS: MultiplierField[] = ["amount", "customerCount", "contractCount", "shipmentCount"];

const MODULE_OPTIONS: Array<{ key: ModuleField; label: string; description: string }> = [
  { key: "operatingKpis", label: "经营指标", description: "本期合同额、客户与合同数量等左侧经营读数" },
  { key: "deliveryMap", label: "交付态势地图", description: "中央全国交付路线地图与省级发货量" },
  { key: "collection", label: "合同与回款", description: "累计回款圆环与月度目标完成情况" },
  { key: "deliveryAlerts", label: "交付预警", description: "今日应发、7 日内待发与逾期未发提醒" },
  { key: "deliveryMilestones", label: "交付里程碑", description: "底部交付里程碑样本列表" },
];

const MULTIPLIER_OPTIONS: Array<{ key: MultiplierField; label: string; description: string }> = [
  { key: "amount", label: "金额倍率", description: "影响本期/累计合同额、回款金额、月度目标等所有金额读数" },
  { key: "customerCount", label: "客户数倍率", description: "影响客户总数、新增客户数与跟进计数" },
  { key: "contractCount", label: "合同数倍率", description: "影响新签、未付款、部分回款合同数量" },
  { key: "shipmentCount", label: "发货数倍率", description: "影响发货单数、交付台数、预警与里程碑台数" },
];

const CONTRACT_NUMBER_MODE_OPTIONS = [
  { value: "masked", label: "遮掩显示（仅保留末尾识别字符）" },
  { value: "hidden", label: "完全隐藏（不返回合同编号）" },
] as const;

const ADDRESS_LEVEL_OPTIONS = [
  { value: "provinceCity", label: "省份 + 城市" },
  { value: "province", label: "仅省份" },
] as const;

const cardClass = "rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-4 shadow-[var(--shadow-card)]";
const primaryButtonClass = "rounded-[var(--radius-md)] bg-[var(--brand-orange)] px-4 py-2 text-sm text-white hover:bg-[var(--brand-orange-hover)] disabled:opacity-50 disabled:hover:bg-[var(--brand-orange)]";
const secondaryButtonClass = "rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50 disabled:hover:bg-transparent";
const dangerButtonClass = "rounded-[var(--radius-md)] border border-[var(--danger)] px-3 py-1.5 text-sm text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50";
const checkboxClass = "size-4 accent-[var(--brand-orange)]";
const inputClass = "rounded border border-[var(--border)] bg-transparent px-2 py-1 text-sm";

/* ==================== 纯函数与请求封装（供测试与组件共用） ==================== */

export function findSalesScreenSetting(items: unknown): SalesScreenConfig {
  const row = Array.isArray(items)
    ? items.find((item) => !!item && typeof item === "object" && (item as { key?: unknown }).key === SALES_SCREEN_SETTING_KEY)
    : undefined;
  return normalizeSalesScreenConfig(row ? (row as { value?: unknown }).value : undefined);
}

export function formFromConfig(config: SalesScreenConfig): SalesScreenFormState {
  return {
    enabled: config.enabled,
    modules: { ...config.modules },
    multiplierText: {
      amount: String(config.multipliers.amount),
      customerCount: String(config.multipliers.customerCount),
      contractCount: String(config.multipliers.contractCount),
      shipmentCount: String(config.multipliers.shipmentCount),
    },
    privacy: { ...config.privacy },
  };
}

export function validateSalesScreenConfigForm(form: SalesScreenFormState): string | null {
  if (!Object.values(form.modules).some((enabled) => enabled)) {
    return "至少需要启用一个板块";
  }
  for (const field of MULTIPLIER_FIELDS) {
    const text = form.multiplierText[field].trim();
    const value = Number(text);
    if (!text || !Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > 100) {
      return "倍率必须是 1～100 的整数";
    }
  }
  return null;
}

export type ConfigFormParseResult = { ok: true; config: SalesScreenConfig } | { ok: false; error: string };

export function buildConfigFromForm(form: SalesScreenFormState): ConfigFormParseResult {
  const error = validateSalesScreenConfigForm(form);
  if (error) return { ok: false, error };
  const multipliers = {} as SalesScreenConfig["multipliers"];
  for (const field of MULTIPLIER_FIELDS) {
    multipliers[field] = Number(form.multiplierText[field].trim());
  }
  return {
    ok: true,
    config: { version: 1, enabled: form.enabled, modules: { ...form.modules }, multipliers, privacy: { ...form.privacy } },
  };
}

export type SaveConfigResult = ConfigFormParseResult;

/** 校验通过才发起 PUT；任何失败都原样返回服务端中文业务消息 */
export async function saveSalesScreenForm(form: SalesScreenFormState): Promise<SaveConfigResult> {
  const parsed = buildConfigFromForm(form);
  if (!parsed.ok) return parsed;
  try {
    const response = await fetch("/api/system/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: SALES_SCREEN_SETTING_KEY, value: parsed.config }),
    });
    const data = (await response.json().catch(() => null)) as { value?: unknown; error?: string } | null;
    if (!response.ok) {
      return { ok: false, error: data?.error ?? "保存失败" };
    }
    return { ok: true, config: normalizeSalesScreenConfig(data?.value ?? parsed.config) };
  } catch {
    return { ok: false, error: "保存失败" };
  }
}

export type ShareActionResult = { ok: true; view: SalesScreenShareView } | { ok: false; error: string };

export async function requestSalesScreenShareAction(method: "GET" | "POST" | "DELETE"): Promise<ShareActionResult> {
  try {
    const response = await fetch("/api/system/sales-screen/share", { method, cache: "no-store" });
    const data = (await response.json().catch(() => null)) as SalesScreenShareView | { error?: string } | null;
    if (!response.ok) {
      return { ok: false, error: (data as { error?: string } | null)?.error ?? "共享链接操作失败" };
    }
    return { ok: true, view: data as SalesScreenShareView };
  } catch {
    return { ok: false, error: "共享链接操作失败" };
  }
}

/** 复制只拼当前站点 origin + 接口返回的相对路径；任何绝对 URL 都不会写回服务器 */
export function buildShareUrl(origin: string, path: string): string {
  const trimmedOrigin = origin.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedOrigin}${normalizedPath}`;
}

export async function copyShareText(
  text: string,
  clipboard?: { writeText(value: string): Promise<void> },
): Promise<boolean> {
  const target = clipboard ?? (globalThis.navigator as Navigator | undefined)?.clipboard;
  if (!target?.writeText) return false;
  try {
    await target.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function formatShareTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("zh-CN", { hour12: false });
}

/* ==================== 展示组件 ==================== */

export type SalesScreenConfigPanelProps = {
  form: SalesScreenFormState;
  loading: boolean;
  saving: boolean;
  error: string;
  notice: string;
  onToggleEnabled(enabled: boolean): void;
  onToggleModule(key: ModuleField, enabled: boolean): void;
  onMultiplierChange(field: MultiplierField, text: string): void;
  onContractNumberModeChange(value: SalesScreenConfig["privacy"]["contractNumberMode"]): void;
  onAddressLevelChange(value: SalesScreenConfig["privacy"]["addressLevel"]): void;
  onToggleDisplayNotice(enabled: boolean): void;
  onSave(): void;
};

export function SalesScreenConfigPanel({
  form,
  loading,
  saving,
  error,
  notice,
  onToggleEnabled,
  onToggleModule,
  onMultiplierChange,
  onContractNumberModeChange,
  onAddressLevelChange,
  onToggleDisplayNotice,
  onSave,
}: SalesScreenConfigPanelProps) {
  return (
    <section className={cardClass} aria-label="展厅大屏配置">
      <div>
        <h2 className="font-medium">展厅大屏配置</h2>
        <p className="mt-1 text-sm text-gray-500">
          配置展厅 LED 大屏展示的板块、展示倍率与隐私口径。
          <span className="ml-1 font-medium text-[var(--brand-orange)]">仅改变公开大屏显示，不修改 CRM/ERP 真实数据。</span>
        </p>
      </div>

      {error ? <p className="mt-3 text-sm text-red-600" role="alert">{error}</p> : null}
      {notice ? <p className="mt-3 text-sm text-emerald-600" role="status">{notice}</p> : null}
      {loading ? <p className="mt-3 text-sm text-gray-500">正在加载大屏配置…</p> : null}

      <label className="mt-4 flex items-center justify-between gap-3 text-sm">
        <span>
          <span className="font-medium">大屏总开关</span>
          <span className="ml-2 text-xs text-gray-500">关闭后共享链接打开的大屏统一显示「大屏不可用」。</span>
        </span>
        <input
          type="checkbox"
          aria-label="大屏总开关"
          checked={form.enabled}
          disabled={loading}
          onChange={(event) => onToggleEnabled(event.target.checked)}
          className={checkboxClass}
        />
      </label>

      <div className="mt-4">
        <h3 className="text-sm font-medium">展示板块</h3>
        <p className="mt-1 text-xs text-gray-500">至少启用一个板块；关闭的板块在大屏上消失，其余板块自动重排。</p>
        <div className="mt-2 space-y-2">
          {MODULE_OPTIONS.map((option) => (
            <label key={option.key} className="flex items-center justify-between gap-3 text-sm">
              <span>
                <span className="font-medium">{option.label}</span>
                <span className="ml-2 text-xs text-gray-500">{option.description}</span>
              </span>
              <input
                type="checkbox"
                aria-label={`${option.label}板块开关`}
                checked={form.modules[option.key]}
                disabled={loading}
                onChange={(event) => onToggleModule(option.key, event.target.checked)}
                className={checkboxClass}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-medium">展示倍率</h3>
        <p className="mt-1 text-xs text-gray-500">只作用于大屏展示数值，整数 1～100；平台内部统计始终为真实数据。</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {MULTIPLIER_OPTIONS.map((option) => (
            <label key={option.key} className="flex items-center justify-between gap-3 text-sm">
              <span>
                <span className="font-medium">{option.label}</span>
                <span className="ml-2 text-xs text-gray-500">{option.description}</span>
              </span>
              <input
                type="number"
                aria-label={option.label}
                min={1}
                max={100}
                step={1}
                value={form.multiplierText[option.key]}
                disabled={loading}
                onChange={(event) => onMultiplierChange(option.key, event.target.value)}
                className={`${inputClass} w-20`}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">合同编号显示</span>
          <select
            aria-label="合同编号显示"
            value={form.privacy.contractNumberMode}
            disabled={loading}
            onChange={(event) => onContractNumberModeChange(event.target.value as SalesScreenConfig["privacy"]["contractNumberMode"])}
            className={`${inputClass} mt-1 w-full`}
          >
            {CONTRACT_NUMBER_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium">地址粒度</span>
          <select
            aria-label="地址粒度"
            value={form.privacy.addressLevel}
            disabled={loading}
            onChange={(event) => onAddressLevelChange(event.target.value as SalesScreenConfig["privacy"]["addressLevel"])}
            className={`${inputClass} mt-1 w-full`}
          >
            {ADDRESS_LEVEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-4 flex items-center justify-between gap-3 text-sm">
        <span>
          <span className="font-medium">展厅演示数据</span>
          <span className="ml-2 text-xs text-gray-500">在大屏角落显示「展厅演示数据，仅供展示」标识。</span>
        </span>
        <input
          type="checkbox"
          aria-label="显示展厅演示数据标识"
          checked={form.privacy.showDisplayNotice}
          disabled={loading}
          onChange={(event) => onToggleDisplayNotice(event.target.checked)}
          className={checkboxClass}
        />
      </label>

      <button
        type="button"
        onClick={onSave}
        disabled={loading || saving}
        className={`${primaryButtonClass} mt-4`}
      >
        {saving ? "保存中..." : "保存大屏配置"}
      </button>
    </section>
  );
}

export type ShareConfirmAction = "rotate" | "revoke";

export function SalesScreenShareConfirmDialog({
  action,
  onConfirm,
  onCancel,
}: {
  action: ShareConfirmAction;
  onConfirm(): void;
  onCancel(): void;
}) {
  if (action === "rotate") {
    return (
      <ConfirmDialog
        open
        danger
        title="重新生成共享链接"
        description="旧链接将立即失效，已打开的大屏会在下次刷新时变为「大屏不可用」，需要改用新链接。确定要重新生成吗？"
        confirmText="重新生成"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
  }
  return (
    <ConfirmDialog
      open
      danger
      title="撤销共享链接"
      description="撤销后当前链接立即失效且无法恢复，所有打开中的大屏都会显示「大屏不可用」。确定要撤销吗？"
      confirmText="撤销链接"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

export type SalesScreenSharePanelProps = {
  view: SalesScreenShareView | null;
  loading: boolean;
  busy: boolean;
  error: string;
  notice: string;
  onGenerate(): void;
  onRotate(): void;
  onRevoke(): void;
  onCopy(): void;
  onPreview(): void;
};

export function SalesScreenSharePanel({
  view,
  loading,
  busy,
  error,
  notice,
  onGenerate,
  onRotate,
  onRevoke,
  onCopy,
  onPreview,
}: SalesScreenSharePanelProps) {
  const hasLink = view?.path != null && view.path !== "";
  const isRevoked = !hasLink && !!view?.share.revokedAt;

  return (
    <section className={cardClass} aria-label="展厅大屏共享链接">
      <div>
        <h2 className="font-medium">展厅大屏共享链接</h2>
        <p className="mt-1 text-sm text-gray-500">
          生成后 LED 屏电脑无需登录 CRM，打开链接即可展示；链接可随时重新生成或撤销。
        </p>
      </div>

      {error ? <p className="mt-3 text-sm text-red-600" role="alert">{error}</p> : null}
      {notice ? <p className="mt-3 text-sm text-emerald-600" role="status">{notice}</p> : null}
      {loading ? <p className="mt-3 text-sm text-gray-500">正在加载共享状态…</p> : null}

      {!loading && hasLink ? (
        <div className="mt-3">
          <p className="text-sm font-medium text-emerald-600" role="status">共享链接生效中</p>
          <code className="mt-1 block break-all rounded border border-[var(--border)] bg-[var(--surface-muted)] p-2 text-xs">{view?.path}</code>
          <p className="mt-1 text-xs text-gray-500">
            {view?.share.createdAt ? `生成于 ${formatShareTime(view.share.createdAt)}` : null}
            {view?.share.rotatedAt ? ` · 轮换于 ${formatShareTime(view.share.rotatedAt)}` : null}
          </p>
        </div>
      ) : null}

      {!loading && isRevoked ? (
        <div className="mt-3">
          <p className="text-sm font-medium text-red-600">共享链接已撤销</p>
          <p className="mt-1 text-xs text-gray-500">{view?.share.revokedAt ? `撤销于 ${formatShareTime(view.share.revokedAt)}` : null}</p>
        </div>
      ) : null}

      {!loading && !hasLink && !isRevoked ? (
        <p className="mt-3 text-sm text-gray-500">尚未生成共享链接。</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {hasLink ? (
          <>
            <button type="button" onClick={onCopy} disabled={busy} className={secondaryButtonClass}>复制链接</button>
            <button type="button" onClick={onPreview} disabled={busy} className={secondaryButtonClass}>浏览器预览</button>
            <button type="button" onClick={onRotate} disabled={busy} className={secondaryButtonClass}>重新生成链接</button>
            <button type="button" onClick={onRevoke} disabled={busy} className={dangerButtonClass}>撤销链接</button>
          </>
        ) : (
          <button type="button" onClick={onGenerate} disabled={busy || loading} className={primaryButtonClass}>生成链接</button>
        )}
      </div>
    </section>
  );
}

/* ==================== 状态容器 ==================== */

export function SalesScreenConfigCard() {
  const [form, setForm] = useState<SalesScreenFormState>(() => formFromConfig(DEFAULT_SALES_SCREEN_CONFIG));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [shareView, setShareView] = useState<SalesScreenShareView | null>(null);
  const sharePath = shareView?.path ?? null;
  const [shareLoading, setShareLoading] = useState(true);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState("");
  const [shareNotice, setShareNotice] = useState("");
  const [confirmAction, setConfirmAction] = useState<ShareConfirmAction | null>(null);

  // 仅在挂载时执行一次；loading 初始即为 true，不在 effect 内同步 setState
  const reloadConfig = useCallback(async () => {
    try {
      const response = await fetch("/api/system/settings", { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as { items?: unknown; error?: string } | null;
      if (!response.ok) {
        setError(data?.error ?? "配置加载失败");
        return;
      }
      setForm(formFromConfig(findSalesScreenSetting(data?.items)));
    } catch {
      setError("配置加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadShare = useCallback(async () => {
    const result = await requestSalesScreenShareAction("GET");
    setShareLoading(false);
    if (result.ok) {
      setShareView(result.view);
    } else {
      setShareError(result.error);
    }
  }, []);

  useEffect(() => { void reloadConfig(); }, [reloadConfig]);
  useEffect(() => { void reloadShare(); }, [reloadShare]);

  const handleSave = useCallback(async () => {
    if (saving || loading) return;
    setSaving(true);
    setError("");
    setNotice("");
    const result = await saveSalesScreenForm(form);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setForm(formFromConfig(result.config));
    setNotice("已保存，公开大屏将在下次刷新时生效");
  }, [form, loading, saving]);

  const runShareMutation = useCallback(async (method: "POST" | "DELETE", successNotice: string) => {
    if (shareBusy) return;
    setShareBusy(true);
    setShareError("");
    setShareNotice("");
    const result = await requestSalesScreenShareAction(method);
    setShareBusy(false);
    if (result.ok) {
      setShareView(result.view);
      setShareNotice(successNotice);
    } else {
      setShareError(result.error);
    }
  }, [shareBusy]);

  const handleGenerate = useCallback(() => {
    if (sharePath) return;
    void runShareMutation("POST", "新链接已生成");
  }, [runShareMutation, sharePath]);

  const handleConfirmAction = useCallback(() => {
    const action = confirmAction;
    setConfirmAction(null);
    if (action === "rotate") void runShareMutation("POST", "新链接已生成，旧链接已失效");
    if (action === "revoke") void runShareMutation("DELETE", "共享链接已撤销，公开大屏已不可用");
  }, [confirmAction, runShareMutation]);

  const handleCopy = useCallback(async () => {
    if (!sharePath) return;
    setShareError("");
    setShareNotice("");
    const ok = await copyShareText(buildShareUrl(window.location.origin, sharePath));
    if (ok) {
      setShareNotice("已复制链接，可粘贴到大屏电脑浏览器打开");
    } else {
      setShareError("复制失败，请手动复制链接");
    }
  }, [sharePath]);

  const handlePreview = useCallback(() => {
    if (!sharePath) return;
    window.open(buildShareUrl(window.location.origin, sharePath), "_blank", "noopener");
  }, [sharePath]);

  return (
    <div className="space-y-5">
      <SalesScreenConfigPanel
        form={form}
        loading={loading}
        saving={saving}
        error={error}
        notice={notice}
        onToggleEnabled={(enabled) => setForm((current) => ({ ...current, enabled }))}
        onToggleModule={(key, enabled) => setForm((current) => ({ ...current, modules: { ...current.modules, [key]: enabled } }))}
        onMultiplierChange={(field, text) => setForm((current) => ({ ...current, multiplierText: { ...current.multiplierText, [field]: text } }))}
        onContractNumberModeChange={(value) => setForm((current) => ({ ...current, privacy: { ...current.privacy, contractNumberMode: value } }))}
        onAddressLevelChange={(value) => setForm((current) => ({ ...current, privacy: { ...current.privacy, addressLevel: value } }))}
        onToggleDisplayNotice={(enabled) => setForm((current) => ({ ...current, privacy: { ...current.privacy, showDisplayNotice: enabled } }))}
        onSave={() => void handleSave()}
      />
      <SalesScreenSharePanel
        view={shareView}
        loading={shareLoading}
        busy={shareBusy}
        error={shareError}
        notice={shareNotice}
        onGenerate={handleGenerate}
        onRotate={() => setConfirmAction("rotate")}
        onRevoke={() => setConfirmAction("revoke")}
        onCopy={() => void handleCopy()}
        onPreview={handlePreview}
      />
      {confirmAction ? (
        <SalesScreenShareConfirmDialog
          action={confirmAction}
          onConfirm={handleConfirmAction}
          onCancel={() => setConfirmAction(null)}
        />
      ) : null}
    </div>
  );
}
