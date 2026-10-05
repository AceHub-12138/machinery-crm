import type { XiaochuanTierProfile } from "@/lib/agent/config";

type LlmClientConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  requestTimeoutMs: number;
};

/**
 * 小川大脑总机：直连硅基流动（OpenAI 兼容 /chat/completions）的流式客户端。
 * API Key 只在服务端使用，绝不进入日志或响应。
 */

export type LlmMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type LlmToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type LlmToolCall = { id: string; name: string; arguments: string };

export type LlmStreamEvent =
  | { type: "reasoning"; text: string }
  | { type: "delta"; text: string }
  | { type: "tool_calls"; calls: LlmToolCall[] }
  | { type: "done"; finishReason: string | null; promptTokens: number | null; completionTokens: number | null };

export class LlmUpstreamError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "LlmUpstreamError";
  }
}

const MAX_ERROR_BODY_CHARS = 300;

function pickFinishReason(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  return null;
}

async function readUpstreamError(response: Response): Promise<LlmUpstreamError> {
  let detail = "";
  try {
    detail = (await response.text()).replace(/\s+/g, " ").slice(0, MAX_ERROR_BODY_CHARS);
  } catch {
    detail = "";
  }
  const hint = response.status === 401 || response.status === 403
    ? "AI 服务鉴权失败，请检查平台模型配置"
    : response.status === 429
      ? "AI 服务繁忙，请稍后再试"
      : "AI 服务暂时不可用，请稍后再试";
  return new LlmUpstreamError(response.status, detail ? `${hint}（${detail}）` : hint);
}

export async function* streamXiaochuanChat(options: {
  config: LlmClientConfig;
  /** 当前这一轮的档位参数（引擎按轮次决定是否关闭思考） */
  tierProfile: XiaochuanTierProfile;
  messages: LlmMessage[];
  tools?: LlmToolSpec[];
  signal?: AbortSignal;
}): AsyncGenerator<LlmStreamEvent> {
  const { config, tierProfile, messages, tools, signal } = options;

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      ...(tools && tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: tierProfile.maxOutputTokens,
      // 硅基流动混合推理模型（K2.6 等）：关闭深度思考可提速且成本约千分之一
      // 仅在关闭时下发，开思考的档位走模型默认行为
      ...(tierProfile.enableThinking === false ? { enable_thinking: false } : {}),
    }),
  });

  if (!response.ok) throw await readUpstreamError(response);
  if (!response.body) throw new LlmUpstreamError(502, "AI 服务返回了空响应");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  type PendingToolCall = { id: string; name: string; arguments: string };
  const pendingToolCalls = new Map<number, PendingToolCall>();
  let finishReason: string | null = null;
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;

  const flushLine = function* (line: string): Generator<LlmStreamEvent> {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let chunk: {
      choices?: Array<{
        delta?: {
          content?: string | null;
          /** 混合推理模型（K2.6 等）的思考内容增量 */
          reasoning_content?: string | null;
          tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
        };
        finish_reason?: string | null;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
    };
    try {
      chunk = JSON.parse(payload);
    } catch {
      return;
    }
    const choice = chunk.choices?.[0];
    const delta = choice?.delta;
    if (delta?.reasoning_content) yield { type: "reasoning", text: delta.reasoning_content };
    if (delta?.content) yield { type: "delta", text: delta.content };
    if (delta?.tool_calls) {
      for (const call of delta.tool_calls) {
        const existing = pendingToolCalls.get(call.index) ?? { id: "", name: "", arguments: "" };
        if (call.id) existing.id = call.id;
        if (call.function?.name) existing.name = call.function.name;
        if (call.function?.arguments) existing.arguments += call.function.arguments;
        pendingToolCalls.set(call.index, existing);
      }
    }
    if (choice?.finish_reason) finishReason = pickFinishReason(choice.finish_reason);
    if (chunk.usage) {
      promptTokens = typeof chunk.usage.prompt_tokens === "number" ? chunk.usage.prompt_tokens : promptTokens;
      completionTokens = typeof chunk.usage.completion_tokens === "number" ? chunk.usage.completion_tokens : completionTokens;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        yield* flushLine(line);
        newlineIndex = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield* flushLine(buffer);
  } finally {
    reader.releaseLock();
  }

  if (pendingToolCalls.size > 0) {
    const calls = [...pendingToolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => call);
    yield { type: "tool_calls", calls };
  }
  yield { type: "done", finishReason, promptTokens, completionTokens };
}
