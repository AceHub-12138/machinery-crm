type Environment = Record<string, string | undefined>;

export type XiaochuanThinkingTier = "fast" | "standard" | "deep";

export const XIAOCHUAN_THINKING_TIERS: XiaochuanThinkingTier[] = ["fast", "standard", "deep"];

export const XIAOCHUAN_TIER_LABELS: Record<XiaochuanThinkingTier, string> = {
  fast: "⚡ 小川快跑",
  standard: "🤔 陷入沉思",
  deep: "🐂 牛来！",
};

export type XiaochuanTierProfile = {
  maxOutputTokens: number;
  /** 是否开启模型深度思考（K2.6 等混合推理模型：关闭后速度极快、成本约千分之一） */
  enableThinking: boolean;
  /** 追加到系统提示词的思考深度指令 */
  styleDirective: string;
};

export type XiaochuanConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 视觉读图专用模型（图片/PDF 页面识别），缺省回落主模型。
   *  2026-09 实测：Kimi-K2.6 Pro 渠道对大图生成过慢（千字读图报告超 5 分钟必然超时），
   *  需单独配高速视觉模型（如 Qwen/Qwen3-VL-30B-A3B-Instruct）；对话大脑保持主模型不变。 */
  visionModel: string;
  /** 引擎最多进行几轮“思考→调工具”循环 */
  maxToolIterations: number;
  /** 单次 LLM 请求超时 */
  requestTimeoutMs: number;
  /** 一次完整提问的总体超时（含多轮工具调用） */
  overallTimeoutMs: number;
  /** 每用户每分钟提问上限 */
  rateLimitPerMinute: number;
  /** 请求体大小上限 */
  maxRequestBytes: number;
  /** 携带给大脑的历史消息条数上限 */
  historyMessageLimit: number;
  /** 单个图片附件的视觉读图超时（段 3） */
  visionTimeoutMs: number;
  tiers: Record<XiaochuanThinkingTier, XiaochuanTierProfile>;
};

function required(environment: Environment, name: string, allowMissing = false) {
  const value = String(environment[name] || "").trim();
  if (!value) {
    if (allowMissing) return "";
    throw new Error(`${name} is required`);
  }
  return value;
}

function integer(environment: Environment, name: string, fallback: number, min: number, max: number) {
  const value = Number(environment[name] || fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function normalizedBaseUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("XIAOCHUAN_LLM_BASE_URL must be an HTTP(S) URL without credentials or fragment");
  }
  return url.toString().replace(/\/$/, "");
}

const DEFAULT_TIERS: Record<XiaochuanThinkingTier, XiaochuanTierProfile> = {
  fast: {
    maxOutputTokens: 1_500,
    enableThinking: false,
    styleDirective: "当前为「小川快跑」档：跳过长篇推理，直接给出简洁、口语化的回答，能一句话说清就不写第二句。",
  },
  standard: {
    // 8192：K2.6 的 reasoning_content 计入 max_tokens，思考长时 4096 会被吃光导致正文空截断（2026-09-11 实测）
    maxOutputTokens: 8_192,
    enableThinking: true,
    styleDirective: "当前为「陷入沉思」档（默认）：先判断是否需要查数据，需要时调用工具，再给出结构清晰、重点突出的回答。",
  },
  deep: {
    maxOutputTokens: 16_384,
    enableThinking: true,
    styleDirective: "当前为「牛来！」档：进行深入的多步推理，充分交叉核对工具返回的数据，逐项论证后再给出详尽、有依据的回答。",
  },
};

function resolveTier(value: string | undefined, fallback: XiaochuanTierProfile, name: string): XiaochuanTierProfile {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== "object") throw new Error(`${name} must be a JSON object`);
  const input = parsed as Record<string, unknown>;
  return {
    maxOutputTokens: input.maxOutputTokens === undefined
      ? fallback.maxOutputTokens
      : integer(input as Environment, "maxOutputTokens", fallback.maxOutputTokens, 128, 65_536),
    enableThinking: input.enableThinking === undefined
      ? fallback.enableThinking
      : input.enableThinking === true,
    styleDirective: typeof input.styleDirective === "string" && input.styleDirective.trim()
      ? input.styleDirective.trim()
      : fallback.styleDirective,
  };
}

export function parseXiaochuanThinkingTier(value: unknown): XiaochuanThinkingTier {
  const normalized = String(value || "").trim().toLowerCase();
  if ((XIAOCHUAN_THINKING_TIERS as string[]).includes(normalized)) return normalized as XiaochuanThinkingTier;
  // 默认档=小川快跑（2026-09-03 用户拍板：日常查询秒答，深度思考按需手动选）
  return "fast";
}

export function loadXiaochuanConfig(
  environment: Environment = process.env,
  // Agent 管理的"模型与 API Key 配置"存库后，apiKey 可以完全由数据库提供（model-config-store）；
  // 此时 env 允许缺 Key，缺了也不会误报"服务未配置"。
  options?: { allowMissingApiKey?: boolean },
): XiaochuanConfig {
  return {
    apiKey: required(environment, "XIAOCHUAN_LLM_API_KEY", options?.allowMissingApiKey === true),
    baseUrl: normalizedBaseUrl(String(environment.XIAOCHUAN_LLM_BASE_URL || "https://api.siliconflow.cn/v1")),
    model: String(environment.XIAOCHUAN_LLM_MODEL || "moonshotai/Kimi-K2.6").trim(),
    visionModel: String(environment.XIAOCHUAN_VISION_MODEL || environment.XIAOCHUAN_LLM_MODEL || "moonshotai/Kimi-K2.6").trim(),
    maxToolIterations: integer(environment, "XIAOCHUAN_MAX_TOOL_ITERATIONS", 6, 1, 12),
    // 上限 300s：K2.6 深度思考输出长度不可控（实测可超 4000 token），Pro 渠道 ~23tok/s 时
    // 长思考 120s 不够用（2026-09-11 用户实测断流）；默认仍 30s，部署时按渠道速度显式配置
    requestTimeoutMs: integer(environment, "XIAOCHUAN_REQUEST_TIMEOUT_MS", 30_000, 3_000, 300_000),
    overallTimeoutMs: integer(environment, "XIAOCHUAN_OVERALL_TIMEOUT_MS", 90_000, 5_000, 300_000),
    rateLimitPerMinute: integer(environment, "XIAOCHUAN_RATE_LIMIT_PER_MINUTE", 10, 1, 600),
    maxRequestBytes: integer(environment, "XIAOCHUAN_MAX_REQUEST_BYTES", 1_048_576, 1_024, 10_485_760),
    historyMessageLimit: integer(environment, "XIAOCHUAN_HISTORY_MESSAGE_LIMIT", 20, 2, 100),
    visionTimeoutMs: integer(environment, "XIAOCHUAN_VISION_TIMEOUT_MS", 90_000, 5_000, 180_000),
    tiers: {
      fast: resolveTier(environment.XIAOCHUAN_TIER_FAST_JSON, DEFAULT_TIERS.fast, "XIAOCHUAN_TIER_FAST_JSON"),
      standard: resolveTier(environment.XIAOCHUAN_TIER_STANDARD_JSON, DEFAULT_TIERS.standard, "XIAOCHUAN_TIER_STANDARD_JSON"),
      deep: resolveTier(environment.XIAOCHUAN_TIER_DEEP_JSON, DEFAULT_TIERS.deep, "XIAOCHUAN_TIER_DEEP_JSON"),
    },
  };
}
