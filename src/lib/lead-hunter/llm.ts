/**
 * 获客引擎专用的 LLM 非流式 JSON 调用：复用小川模型配置体系（数据库生效配置优先、env 兜底）。
 * 输出解析容错照抄原 n8n 工作流的 Parse 节点：去 Markdown fence → 截取首末大括号 → 二次 stringify 兼容。
 */

import type { XiaochuanConfig } from "@/lib/agent/config";

export type LlmCaller = (options: { system: string; user: string; maxTokens: number }) => Promise<unknown>;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function parseLlmJsonContent(rawContent: string): unknown {
  let text = String(rawContent ?? "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(text);
  } catch {
    // 容忍"下面是分析结果：{...}"这类包裹输出
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error("LLM 输出中找不到 JSON");
    text = text.slice(firstBrace, lastBrace + 1);
    let parsed: unknown = JSON.parse(text);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    return parsed;
  }
}

export function createLlmCaller(config: XiaochuanConfig, fetchImpl: FetchLike = fetch): LlmCaller {
  const request = async (options: { system: string; user: string; maxTokens: number }) => {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.user },
        ],
        max_tokens: options.maxTokens,
        stream: false,
        // 获客批处理追求快与省：与对话引擎同款做法，显式关闭深度思考
        enable_thinking: false,
      }),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
      throw new Error(`LLM 调用失败 ${response.status}${detail ? `：${detail}` : ""}`);
    }
    const data = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content || !String(content).trim()) throw new Error("LLM 返回了空内容");
    return parseLlmJsonContent(String(content));
  };

  // 失败自动重试 1 次（原 n8n Planner 节点同款 maxTries=2 语义）
  return async (options) => {
    try {
      return await request(options);
    } catch {
      return await request(options);
    }
  };
}
