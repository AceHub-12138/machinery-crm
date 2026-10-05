import { describe, expect, it } from "vitest";
import {
  loadXiaochuanConfig,
  parseXiaochuanThinkingTier,
  XIAOCHUAN_TIER_LABELS,
  XIAOCHUAN_THINKING_TIERS,
} from "@/lib/agent/config";

const BASE_ENV = { XIAOCHUAN_LLM_API_KEY: "test-key" };

describe("loadXiaochuanConfig", () => {
  it("缺少 API Key 时给出明确错误", () => {
    expect(() => loadXiaochuanConfig({})).toThrow("XIAOCHUAN_LLM_API_KEY is required");
  });

  it("默认值指向硅基流动与 Kimi-K2.6", () => {
    const config = loadXiaochuanConfig(BASE_ENV);
    expect(config.baseUrl).toBe("https://api.siliconflow.cn/v1");
    expect(config.model).toBe("moonshotai/Kimi-K2.6");
    expect(config.maxToolIterations).toBe(6);
    expect(config.rateLimitPerMinute).toBe(10);
    expect(config.tiers.standard.maxOutputTokens).toBeGreaterThan(config.tiers.fast.maxOutputTokens);
    expect(config.tiers.deep.maxOutputTokens).toBeGreaterThan(config.tiers.standard.maxOutputTokens);
  });

  it("快跑档关闭深度思考，沉思/牛来档保持思考", () => {
    const config = loadXiaochuanConfig(BASE_ENV);
    expect(config.tiers.fast.enableThinking).toBe(false);
    expect(config.tiers.standard.enableThinking).toBe(true);
    expect(config.tiers.deep.enableThinking).toBe(true);
  });

  it("baseUrl 带路径时保留并去掉尾部斜杠", () => {
    const config = loadXiaochuanConfig({ ...BASE_ENV, XIAOCHUAN_LLM_BASE_URL: "https://example.com/api/v1/" });
    expect(config.baseUrl).toBe("https://example.com/api/v1");
  });

  it("拒绝带凭据的 baseUrl", () => {
    expect(() => loadXiaochuanConfig({
      ...BASE_ENV,
      XIAOCHUAN_LLM_BASE_URL: "https://user:pass@example.com/v1",
    })).toThrow();
  });

  it("支持按档位覆盖 JSON 配置", () => {
    const config = loadXiaochuanConfig({
      ...BASE_ENV,
      XIAOCHUAN_TIER_FAST_JSON: JSON.stringify({ maxOutputTokens: 256, enableThinking: true, styleDirective: "只回一句话" }),
    });
    expect(config.tiers.fast.maxOutputTokens).toBe(256);
    expect(config.tiers.fast.enableThinking).toBe(true);
    expect(config.tiers.fast.styleDirective).toBe("只回一句话");
    expect(config.tiers.standard.maxOutputTokens).not.toBe(256);
  });

  it("档位覆盖 JSON 非法时明确报错", () => {
    expect(() => loadXiaochuanConfig({
      ...BASE_ENV,
      XIAOCHUAN_TIER_DEEP_JSON: "{not-json",
    })).toThrow("XIAOCHUAN_TIER_DEEP_JSON must be valid JSON");
  });
});

describe("parseXiaochuanThinkingTier", () => {
  it("接受合法档位", () => {
    expect(parseXiaochuanThinkingTier("fast")).toBe("fast");
    expect(parseXiaochuanThinkingTier("DEEP")).toBe("deep");
  });

  it("非法或缺失档位回落到 fast（默认档=小川快跑）", () => {
    expect(parseXiaochuanThinkingTier("ultra")).toBe("fast");
    expect(parseXiaochuanThinkingTier(undefined)).toBe("fast");
    expect(parseXiaochuanThinkingTier("")).toBe("fast");
  });

  it("三个档位都有中文标签", () => {
    for (const tier of XIAOCHUAN_THINKING_TIERS) {
      expect(XIAOCHUAN_TIER_LABELS[tier]).toBeTruthy();
    }
  });
});
