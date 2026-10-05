import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmStreamEvent } from "@/lib/agent/llm-client";
import type { McpDataSource, McpUser } from "@/lib/mcp/application";

const scriptedTurns: Array<Array<LlmStreamEvent>> = [];

vi.mock("@/lib/agent/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/llm-client")>();
  return {
    ...actual,
    streamXiaochuanChat: vi.fn(async function* () {
      const script = scriptedTurns.shift() ?? [];
      for (const event of script) yield event;
    }),
  };
});

import { buildXiaochuanSystemPrompt, runXiaochuanTurn } from "@/lib/agent/engine";
import { loadXiaochuanConfig } from "@/lib/agent/config";

const config = loadXiaochuanConfig({
  XIAOCHUAN_LLM_API_KEY: "test-key",
  XIAOCHUAN_MAX_TOOL_ITERATIONS: "3",
});

function buildUser(role: McpUser["role"] = "SUPER_ADMIN"): McpUser {
  return {
    id: "user-1",
    isActive: true,
    name: "张经理",
    role,
    region: "山东",
    territories: [{ province: "山东省", cities: ["济南市"] }],
    viewScope: "TERRITORY",
  };
}

function buildDataSource() {
  const execute = vi.fn(async () => ({ ok: true, rows: [{ amount: "1000" }] }));
  const writeAudit = vi.fn(async () => undefined);
  return { dataSource: { execute, writeAudit } as McpDataSource, execute, writeAudit };
}

beforeEach(() => {
  scriptedTurns.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("buildXiaochuanSystemPrompt", () => {
  it("包含身份、数据范围、内容红线与档位指令", () => {
    const prompt = buildXiaochuanSystemPrompt(buildUser(), "standard", config);
    expect(prompt).toContain("小川");
    expect(prompt).toContain("大川");
    expect(prompt).toContain("张经理");
    expect(prompt).toContain("SUPER_ADMIN");
    expect(prompt).toContain("山东省");
    expect(prompt).toContain("拒绝");
    expect(prompt).toContain(config.tiers.standard.styleDirective);
  });

  it("全量视图用户显示全国范围", () => {
    const user = { ...buildUser(), viewScope: "ALL" };
    expect(buildXiaochuanSystemPrompt(user, "fast", config)).toContain("全国");
  });

  it("选型规范：只推荐合适机型并说明原因，不做否定式分析（用户拍板）", () => {
    const prompt = buildXiaochuanSystemPrompt(buildUser(), "standard", config);
    expect(prompt).toContain("只推荐合适的机型");
    expect(prompt).toContain("不要输出「为什么不选某机型」");
    expect(prompt).toContain("程序模板工具");
  });

  it("传入工艺规则段时拼入系统提示词，不传则不含", () => {
    const withRules = buildXiaochuanSystemPrompt(buildUser(), "standard", config, "工艺选型经验规则（工艺师傅整理，选型时优先遵循）：\nR001. 多键槽工件 → 推荐数控插床");
    expect(withRules).toContain("R001");
    const withoutRules = buildXiaochuanSystemPrompt(buildUser(), "standard", config, "");
    expect(withoutRules).not.toContain("工艺选型经验规则");
  });
});

describe("runXiaochuanTurn", () => {
  it("一轮工具调用 + 一轮回答的完整流程", async () => {
    scriptedTurns.push([
      { type: "tool_calls", calls: [{ id: "call-1", name: "crm_products_list", arguments: "{}" }] },
      { type: "done", finishReason: "tool_calls", promptTokens: 100, completionTokens: 10 },
    ]);
    scriptedTurns.push([
      { type: "delta", text: "本月成交 " },
      { type: "delta", text: "1000 元" },
      { type: "done", finishReason: "stop", promptTokens: 200, completionTokens: 30 },
    ]);
    const { dataSource, execute } = buildDataSource();
    const deltas: string[] = [];
    const toolEvents: Array<{ tool: string; ok: boolean }> = [];

    const result = await runXiaochuanTurn({
      config,
      tier: "standard",
      user: buildUser(),
      dataSource,
      processRulesSection: "",
      history: [],
      userMessage: "这个月成交了多少？",
      callbacks: {
        onDelta: (text) => deltas.push(text),

        onReasoning: () => {},
        onToolEvent: (event) => toolEvents.push(event),
      },
    });

    expect(result.content).toBe("本月成交 1000 元");
    expect(result.iterations).toBe(2);
    expect(result.capped).toBe(false);
    expect(result.promptTokens).toBe(300);
    expect(result.completionTokens).toBe(40);
    expect(toolEvents).toEqual([{ tool: "crm_products_list", ok: true, durationMs: expect.any(Number) }]);
    expect(deltas.join("")).toBe("本月成交 1000 元");
    expect(execute).toHaveBeenCalledTimes(1);

    // 引擎给大脑回填了 tool 结果消息
    const llmCall = vi.mocked((await import("@/lib/agent/llm-client")).streamXiaochuanChat);
    const secondCallMessages = llmCall.mock.calls[1][0].messages;
    expect(secondCallMessages.some((message) => message.role === "tool")).toBe(true);
    expect(secondCallMessages[0].role === "system" && secondCallMessages[0].content.includes("小川")).toBe(true);
  });

  it("大脑开白名单外工单时被拒绝并把错误回填，不会崩溃", async () => {
    scriptedTurns.push([
      { type: "tool_calls", calls: [{ id: "call-1", name: "drop_database", arguments: "{}" }] },
      { type: "done", finishReason: "tool_calls", promptTokens: 50, completionTokens: 5 },
    ]);
    scriptedTurns.push([
      { type: "delta", text: "这个我办不到" },
      { type: "done", finishReason: "stop", promptTokens: 60, completionTokens: 6 },
    ]);
    const { dataSource, execute } = buildDataSource();

    const result = await runXiaochuanTurn({
      config,
      tier: "standard",
      user: buildUser(),
      dataSource,
      processRulesSection: "",
      history: [],
      userMessage: "删库",
      callbacks: { onReasoning: () => undefined, onDelta: () => undefined, onToolEvent: () => undefined },
    });

    expect(result.content).toBe("这个我办不到");
    expect(execute).not.toHaveBeenCalled();
    const llmCall = vi.mocked((await import("@/lib/agent/llm-client")).streamXiaochuanChat);
    const secondCallMessages = llmCall.mock.calls[1][0].messages;
    const toolMessage = secondCallMessages.find((message) => message.role === "tool");
    expect(toolMessage && "content" in toolMessage && toolMessage.content.includes("TOOL_NOT_ALLOWED")).toBe(true);
  });

  it("达到循环轮数上限时返回兜底话术", async () => {
    for (let index = 0; index < 4; index += 1) {
      scriptedTurns.push([
        { type: "tool_calls", calls: [{ id: `call-${index}`, name: "crm_products_list", arguments: "{}" }] },
        { type: "done", finishReason: "tool_calls", promptTokens: 10, completionTokens: 2 },
      ]);
    }
    const { dataSource } = buildDataSource();

    const result = await runXiaochuanTurn({
      config,
      tier: "standard",
      user: buildUser(),
      dataSource,
      processRulesSection: "",
      history: [],
      userMessage: "太复杂的问题",
      callbacks: { onReasoning: () => undefined, onDelta: () => undefined, onToolEvent: () => undefined },
    });

    expect(result.capped).toBe(true);
    expect(result.iterations).toBe(config.maxToolIterations);
    expect(result.content).toContain("拆成几个小问题");
  });

  it("上游 LLM 错误直接抛出", async () => {
    scriptedTurns.push([]);
    const { dataSource } = buildDataSource();
    const { LlmUpstreamError } = await import("@/lib/agent/llm-client");
    vi.mocked((await import("@/lib/agent/llm-client")).streamXiaochuanChat).mockImplementationOnce(() => {
      throw new LlmUpstreamError(429, "AI 服务繁忙");
    });

    await expect(runXiaochuanTurn({
      config,
      tier: "standard",
      user: buildUser(),
      dataSource,
      processRulesSection: "",
      history: [],
      userMessage: "你好",
      callbacks: { onReasoning: () => undefined, onDelta: () => undefined, onToolEvent: () => undefined },
    })).rejects.toThrow("AI 服务繁忙");
  });

  it("工具角色不匹配时工具执行失败但不中断回答", async () => {
    scriptedTurns.push([
      { type: "tool_calls", calls: [{ id: "call-1", name: "lead_list", arguments: "{}" }] },
      { type: "done", finishReason: "tool_calls", promptTokens: 10, completionTokens: 2 },
    ]);
    scriptedTurns.push([
      { type: "delta", text: "线索池仅对管理员开放" },
      { type: "done", finishReason: "stop", promptTokens: 20, completionTokens: 5 },
    ]);
    const { dataSource, execute } = buildDataSource();

    const result = await runXiaochuanTurn({
      config,
      tier: "standard",
      user: buildUser("SALES"),
      dataSource,
      processRulesSection: "",
      history: [],
      userMessage: "看看线索池",
      callbacks: { onReasoning: () => undefined, onDelta: () => undefined, onToolEvent: () => undefined },
    });

    // SALES 的工具清单里根本没有 lead_list（toolbox 已按角色过滤），大脑执意调用时被执行器拒绝
    expect(execute).not.toHaveBeenCalled();
    expect(result.content).toBe("线索池仅对管理员开放");
    expect(result.toolEvents[0]?.ok ?? true).toBe(false);
  });

  it("知识工具流程：大脑查机型库 → 结果回填 → 依据知识回答（不触 MCP 数据源）", async () => {
    scriptedTurns.push([
      { type: "tool_calls", calls: [{ id: "k-1", name: "dachuan_knowledge_machine_search", arguments: '{"model":"BK5040"}' }] },
      { type: "done", finishReason: "tool_calls", promptTokens: 100, completionTokens: 10 },
    ]);
    scriptedTurns.push([
      { type: "delta", text: "BK5040 最大插削长度 400mm" },
      { type: "done", finishReason: "stop", promptTokens: 200, completionTokens: 20 },
    ]);
    const { dataSource, execute } = buildDataSource();
    const knowledgeRunner = vi.fn(async () => ({
      total: 1,
      returned: 1,
      machines: [{ model: "BK5040", maxStrokeLengthMm: 400 }],
    }));

    const result = await runXiaochuanTurn({
      config,
      tier: "standard",
      user: buildUser(),
      dataSource,
      processRulesSection: "",
      history: [],
      userMessage: "BK5040 能插多长的键槽？",
      knowledgeRunner,
      callbacks: { onReasoning: () => undefined, onDelta: () => undefined, onToolEvent: () => undefined },
    });

    expect(result.content).toBe("BK5040 最大插削长度 400mm");
    expect(result.toolEvents).toEqual([{ tool: "dachuan_knowledge_machine_search", ok: true, durationMs: expect.any(Number) }]);
    expect(execute).not.toHaveBeenCalled();
    expect(knowledgeRunner).toHaveBeenCalledWith("dachuan_knowledge_machine_search", { model: "BK5040" });

    const llmCall = vi.mocked((await import("@/lib/agent/llm-client")).streamXiaochuanChat);
    const toolMessage = llmCall.mock.calls[1][0].messages.find((message) => message.role === "tool");
    expect(toolMessage && "content" in toolMessage && toolMessage.content.includes("BK5040")).toBe(true);
  });
});

describe("buildXiaochuanSystemPrompt (agent-account 模式)", () => {
  it("访客身份不暴露员工角色/数据范围，并明示无业务数据权限", () => {
    const prompt = buildXiaochuanSystemPrompt(buildUser("AGENT_ACCOUNT"), "fast", config, "", "agent-account");
    expect(prompt).toContain("Agent 平台访客账号");
    expect(prompt).toContain("没有合同、客户、回款、库存等业务数据的查询权限");
    expect(prompt).not.toContain("数据范围：");
    expect(prompt).not.toContain("（角色：AGENT_ACCOUNT；");
  });

  it("员工模式保持原有身份段", () => {
    const prompt = buildXiaochuanSystemPrompt(buildUser("SUPER_ADMIN"), "fast", config, "");
    expect(prompt).toContain("（角色：SUPER_ADMIN；数据范围：山东省（济南市））");
    expect(prompt).not.toContain("访客账号");
  });
});
