import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildConfigFromForm,
  buildShareUrl,
  copyShareText,
  findSalesScreenSetting,
  formFromConfig,
  requestSalesScreenShareAction,
  SalesScreenConfigPanel,
  SalesScreenShareConfirmDialog,
  SalesScreenSharePanel,
  saveSalesScreenForm,
  validateSalesScreenConfigForm,
  type SalesScreenFormState,
  type SalesScreenShareView,
} from "./sales-screen-config-card";
import { DEFAULT_SALES_SCREEN_CONFIG, type SalesScreenConfig } from "@/modules/screen/config";

const activeShareView: SalesScreenShareView = {
  share: {
    version: 1,
    publicId: "a".repeat(43),
    createdAt: "2026-09-22T01:00:00.000Z",
    rotatedAt: null,
    revokedAt: null,
  },
  path: `/screen/sales/${"a".repeat(43)}?kiosk=1`,
};

const revokedShareView: SalesScreenShareView = {
  share: {
    version: 1,
    publicId: null,
    createdAt: "2026-09-22T01:00:00.000Z",
    rotatedAt: null,
    revokedAt: "2026-09-22T02:00:00.000Z",
  },
  path: null,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("findSalesScreenSetting", () => {
  it("falls back to the safe default config when the setting row is missing", () => {
    expect(findSalesScreenSetting([])).toEqual(DEFAULT_SALES_SCREEN_CONFIG);
    expect(findSalesScreenSetting(undefined)).toEqual(DEFAULT_SALES_SCREEN_CONFIG);
    expect(findSalesScreenSetting({ items: [] })).toEqual(DEFAULT_SALES_SCREEN_CONFIG);
  });

  it("reads back a stored salesScreen row from the settings items list", () => {
    const stored: SalesScreenConfig = {
      version: 1,
      enabled: true,
      modules: { operatingKpis: true, deliveryMap: false, collection: true, deliveryAlerts: true, deliveryMilestones: true },
      multipliers: { amount: 5, customerCount: 2, contractCount: 1, shipmentCount: 3 },
      privacy: { contractNumberMode: "hidden", addressLevel: "province", showDisplayNotice: false },
    };
    expect(findSalesScreenSetting([{ key: "reminders", value: {} }, { key: "salesScreen", value: stored }])).toEqual(stored);
  });

  it("repairs corrupted multiplier values back to safe defaults", () => {
    const config = findSalesScreenSetting([{ key: "salesScreen", value: { version: 1, enabled: true, modules: { operatingKpis: true, deliveryMap: true, collection: true, deliveryAlerts: true, deliveryMilestones: true }, multipliers: { amount: 0, customerCount: "5", contractCount: 1, shipmentCount: 1 }, privacy: {} } }]);
    expect(config.multipliers.amount).toBe(1);
    expect(config.multipliers.customerCount).toBe(1);
    expect(config.privacy.contractNumberMode).toBe("masked");
  });
});

describe("validateSalesScreenConfigForm", () => {
  it("rejects a form with every module switched off", () => {
    const form = formFromConfig(DEFAULT_SALES_SCREEN_CONFIG);
    const modules = form.modules as Record<keyof SalesScreenFormState["modules"], boolean>;
    for (const key of Object.keys(modules) as Array<keyof SalesScreenFormState["modules"]>) modules[key] = false;
    expect(validateSalesScreenConfigForm(form)).toBe("至少需要启用一个板块");
  });

  it("rejects multipliers that are not integers within 1-100", () => {
    for (const bad of ["0", "101", "1.5", "abc", ""]) {
      const form = formFromConfig(DEFAULT_SALES_SCREEN_CONFIG);
      form.multiplierText.amount = bad;
      expect(validateSalesScreenConfigForm(form)).toBe("倍率必须是 1～100 的整数");
    }
  });

  it("accepts a fully valid form without errors", () => {
    expect(validateSalesScreenConfigForm(formFromConfig(DEFAULT_SALES_SCREEN_CONFIG))).toBeNull();
  });
});

describe("buildConfigFromForm", () => {
  it("parses multiplier text into integers on the typed config", () => {
    const form = formFromConfig(DEFAULT_SALES_SCREEN_CONFIG);
    form.multiplierText.amount = "5";
    const result = buildConfigFromForm(form);
    expect(result).toEqual({
      ok: true,
      config: { ...DEFAULT_SALES_SCREEN_CONFIG, multipliers: { ...DEFAULT_SALES_SCREEN_CONFIG.multipliers, amount: 5 } },
    });
  });

  it("returns the validation error instead of a config for invalid input", () => {
    const form = formFromConfig(DEFAULT_SALES_SCREEN_CONFIG);
    form.multiplierText.shipmentCount = "101";
    const result = buildConfigFromForm(form);
    if (result.ok) throw new Error("expected invalid form");
    expect(result.error).toBe("倍率必须是 1～100 的整数");
  });
});

describe("saveSalesScreenForm", () => {
  it("blocks invalid multipliers before any request is sent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const form = formFromConfig(DEFAULT_SALES_SCREEN_CONFIG);
    form.multiplierText.customerCount = "0";
    const result = await saveSalesScreenForm(form);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("倍率必须是 1～100 的整数");
  });

  it("puts the salesScreen key to the settings API exactly once and returns the saved config", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ key: "salesScreen", value: DEFAULT_SALES_SCREEN_CONFIG }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await saveSalesScreenForm(formFromConfig(DEFAULT_SALES_SCREEN_CONFIG));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/system/settings");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ key: "salesScreen", value: DEFAULT_SALES_SCREEN_CONFIG });
    expect(result).toEqual({ ok: true, config: DEFAULT_SALES_SCREEN_CONFIG });
  });

  it("surfaces the server Chinese business message verbatim on rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "至少需要启用一个板块" }, 400)));
    const result = await saveSalesScreenForm(formFromConfig(DEFAULT_SALES_SCREEN_CONFIG));
    expect(result).toEqual({ ok: false, error: "至少需要启用一个板块" });
  });
});

describe("requestSalesScreenShareAction", () => {
  it("reads the share state with GET and returns the relative path view", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(activeShareView));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestSalesScreenShareAction("GET")).resolves.toEqual({ ok: true, view: activeShareView });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/system/sales-screen/share");
    expect(init.method).toBe("GET");
  });

  it("sends POST and DELETE to the share endpoint for rotate and revoke", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(activeShareView));
    vi.stubGlobal("fetch", fetchMock);
    await requestSalesScreenShareAction("POST");
    await requestSalesScreenShareAction("DELETE");
    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit).method)).toEqual(["POST", "DELETE"]);
  });

  it("surfaces the server permission message verbatim", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "无权限管理展厅大屏共享链接" }, 403)));
    await expect(requestSalesScreenShareAction("GET")).resolves.toEqual({ ok: false, error: "无权限管理展厅大屏共享链接" });
  });

  it("falls back to a Chinese message when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(requestSalesScreenShareAction("POST")).resolves.toEqual({ ok: false, error: "共享链接操作失败" });
  });
});

describe("buildShareUrl", () => {
  it("joins the current site origin with the relative share path", () => {
    expect(buildShareUrl("https://dachuan.pro", "/screen/sales/abc?kiosk=1")).toBe("https://dachuan.pro/screen/sales/abc?kiosk=1");
    expect(buildShareUrl("https://dachuan.pro/", "/screen/sales/abc?kiosk=1")).toBe("https://dachuan.pro/screen/sales/abc?kiosk=1");
  });
});

describe("copyShareText", () => {
  it("writes the exact text through the clipboard and reports success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(copyShareText("https://dachuan.pro/screen/sales/abc", { writeText })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://dachuan.pro/screen/sales/abc");
  });

  it("reports failure without throwing when the clipboard rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    await expect(copyShareText("https://dachuan.pro/x", { writeText })).resolves.toBe(false);
  });
});

describe("SalesScreenConfigPanel", () => {
  const noop = () => undefined;
  const baseProps = {
    form: formFromConfig(DEFAULT_SALES_SCREEN_CONFIG),
    loading: false,
    saving: false,
    error: "",
    notice: "",
    onToggleEnabled: noop,
    onToggleModule: noop,
    onMultiplierChange: noop,
    onContractNumberModeChange: noop,
    onAddressLevelChange: noop,
    onToggleDisplayNotice: noop,
    onSave: noop,
  };

  it("renders the master switch, five module switches with Chinese descriptions, four multiplier inputs and privacy options", () => {
    const html = renderToStaticMarkup(<SalesScreenConfigPanel {...baseProps} />);
    expect(html).toContain("大屏总开关");
    for (const label of ["经营指标", "交付态势地图", "合同与回款", "交付预警", "交付里程碑"]) {
      expect(html).toContain(label);
    }
    for (const label of ["金额倍率", "客户数倍率", "合同数倍率", "发货数倍率"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('min="1"');
    expect(html).toContain('max="100"');
    expect(html).toContain('step="1"');
    expect(html).toContain("合同编号显示");
    expect(html).toContain("地址粒度");
    expect(html).toContain("展厅演示数据");
  });

  it("states that saving only affects the public screen and never CRM/ERP data", () => {
    const html = renderToStaticMarkup(<SalesScreenConfigPanel {...baseProps} />);
    expect(html).toContain("仅改变公开大屏显示，不修改 CRM/ERP 真实数据");
  });

  it("disables the save button while a save request is in flight", () => {
    const html = renderToStaticMarkup(<SalesScreenConfigPanel {...baseProps} saving />);
    expect(html).toContain("保存中");
    expect(html).toContain("disabled");
  });

  it("shows server errors verbatim and keeps the save button available again afterwards", () => {
    const html = renderToStaticMarkup(<SalesScreenConfigPanel {...baseProps} error="配置包含未知字段" />);
    expect(html).toContain("配置包含未知字段");
  });
});

describe("SalesScreenSharePanel", () => {
  const noop = () => undefined;
  const baseProps = {
    loading: false,
    busy: false,
    error: "",
    notice: "",
    onGenerate: noop,
    onRotate: noop,
    onRevoke: noop,
    onCopy: noop,
    onPreview: noop,
  };

  it("offers link generation when no share link exists", () => {
    const html = renderToStaticMarkup(<SalesScreenSharePanel {...baseProps} view={null} />);
    expect(html).toContain("尚未生成共享链接");
    expect(html).toContain(">生成链接</button>");
  });

  it("shows the active relative path with copy, preview, rotate and revoke controls", () => {
    const html = renderToStaticMarkup(<SalesScreenSharePanel {...baseProps} view={activeShareView} />);
    expect(html).toContain(activeShareView.path as string);
    expect(html).toContain("复制链接");
    expect(html).toContain("浏览器预览");
    expect(html).toContain("重新生成链接");
    expect(html).toContain("撤销链接");
  });

  it("marks a revoked link as unusable and only offers generating a new one", () => {
    const html = renderToStaticMarkup(<SalesScreenSharePanel {...baseProps} view={revokedShareView} />);
    expect(html).toContain("已撤销");
    expect(html).toContain(">生成链接</button>");
    expect(html).not.toContain("复制链接");
    expect(html).not.toContain("重新生成链接");
  });

  it("disables every share control while a request is in flight", () => {
    const html = renderToStaticMarkup(<SalesScreenSharePanel {...baseProps} view={activeShareView} busy />);
    expect((html.match(/disabled/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("shows server errors verbatim in the error channel, not as the green success notice", () => {
    const html = renderToStaticMarkup(<SalesScreenSharePanel {...baseProps} view={null} error="无权限管理展厅大屏共享链接" />);
    expect(html).toContain("无权限管理展厅大屏共享链接");
    expect(html).toContain('role="alert"');
  });
});

describe("SalesScreenShareConfirmDialog", () => {
  it("warns that rotating immediately invalidates the old link", () => {
    const html = renderToStaticMarkup(
      <SalesScreenShareConfirmDialog action="rotate" onConfirm={() => undefined} onCancel={() => undefined} />,
    );
    expect(html).toContain("重新生成共享链接");
    expect(html).toContain("立即失效");
  });

  it("warns that revoking makes every open screen unusable", () => {
    const html = renderToStaticMarkup(
      <SalesScreenShareConfirmDialog action="revoke" onConfirm={() => undefined} onCancel={() => undefined} />,
    );
    expect(html).toContain("撤销共享链接");
    expect(html).toContain("立即失效");
  });
});
