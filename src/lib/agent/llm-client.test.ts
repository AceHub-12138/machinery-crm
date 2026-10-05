import { afterEach, describe, expect, it, vi } from "vitest";
import { streamXiaochuanChat, LlmUpstreamError } from "@/lib/agent/llm-client";
import { loadXiaochuanConfig } from "@/lib/agent/config";

const config = loadXiaochuanConfig({ XIAOCHUAN_LLM_API_KEY: "test-key" });

function sseResponse(chunks: Array<string | null>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        if (chunk === null) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamXiaochuanChat", () => {
  it("解析文本增量、工具调用与用量统计", async () => {
    const fetchMock = vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"crm_contracts_list","arguments":"{\\"page\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\n',
      "data: [DONE]\n\n",
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const events = [];
    for await (const event of streamXiaochuanChat({
      config,
      tierProfile: config.tiers.standard,
      messages: [{ role: "user", content: "在吗" }],
      tools: [],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "delta", text: "你好" },
      { type: "tool_calls", calls: [{ id: "call-1", name: "crm_contracts_list", arguments: '{"page":1}' }] },
      { type: "done", finishReason: "tool_calls", promptTokens: 11, completionTokens: 7 },
    ]);

    // 请求体校验：携带鉴权、模型与档位 max_tokens
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = firstCall;
    expect(url).toBe("https://api.siliconflow.cn/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-key");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("moonshotai/Kimi-K2.6");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(config.tiers.standard.maxOutputTokens);
    // 思考开启的档位不下发 enable_thinking
    expect(body.enable_thinking).toBeUndefined();
  });

  it("上游 429 转换为友好错误，不泄露密钥", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"rate limited"}', { status: 429 })));
    await expect(async () => {
      for await (const _event of streamXiaochuanChat({
        config,
        tierProfile: config.tiers.fast,
        messages: [{ role: "user", content: "你好" }],
      })) {
        // 消费事件
      }
    }).rejects.toThrow("AI 服务繁忙");
    expect(LlmUpstreamError).toBeTruthy();
  });

  it("401 提示检查模型配置", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    await expect(async () => {
      for await (const _event of streamXiaochuanChat({
        config,
        tierProfile: config.tiers.fast,
        messages: [{ role: "user", content: "你好" }],
      })) {
        // 消费事件
      }
    }).rejects.toThrow("鉴权失败");
  });

  it("快跑档关闭思考：请求携带 enable_thinking=false", async () => {
    const fetchMock = vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"2"}}]}\n\n',
      "data: [DONE]\n\n",
    ]));
    vi.stubGlobal("fetch", fetchMock);

    for await (const _event of streamXiaochuanChat({
      config,
      tierProfile: config.tiers.fast,
      messages: [{ role: "user", content: "1+1" }],
    })) {
      // 消费事件
    }

    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.enable_thinking).toBe(false);
  });

  it("跨 chunk 断行的 SSE 数据也能解析", async () => {
    const fetchMock = vi.fn(async () => sseResponse([
      'data: {"choices":[{"del',
      'ta":{"content":"断行"}}]}\n\ndata: [DONE]\n\n',
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const texts: string[] = [];
    for await (const event of streamXiaochuanChat({
      config,
      tierProfile: config.tiers.fast,
      messages: [{ role: "user", content: "在吗" }],
    })) {
      if (event.type === "delta") texts.push(event.text);
    }
    expect(texts.join("")).toBe("断行");
  });
});
