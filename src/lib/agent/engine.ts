import type { McpDataSource, McpUser } from "@/lib/mcp/application";
import { XIAOCHUAN_TIER_LABELS, type XiaochuanConfig, type XiaochuanThinkingTier } from "@/lib/agent/config";
import { buildXiaochuanFullToolSpecs, buildXiaochuanToolSpecs, XIAOCHUAN_ALLOWED_TOOLS } from "@/lib/agent/toolbox";
import { executeAgentTool, type AgentToolOutcome, type CalculatorToolRunner, type KnowledgeToolRunner } from "@/lib/agent/executor";
import { loadProcessRulesSection } from "@/lib/agent/knowledge/queries";
import { streamXiaochuanChat, LlmUpstreamError, type LlmMessage } from "@/lib/agent/llm-client";

/**
 * 小川引擎：实现「思考 → 调工具 → 再思考 → 回答」的循环。
 * 护栏：循环轮数上限、单次请求超时、总体超时、单条工具结果截断、白名单外工单拒绝。
 */

export class AgentTimeoutError extends Error {
  constructor(message = "本轮回答超时。AI 服务通道当前速度波动较大，可改用「小川快跑」档重试，或把问题拆小一点") {
    super(message);
    this.name = "AgentTimeoutError";
  }
}

export type AgentToolEvent = {
  tool: string;
  ok: boolean;
  durationMs: number;
};

export type AgentTurnResult = {
  content: string;
  promptTokens: number;
  completionTokens: number;
  toolEvents: AgentToolEvent[];
  iterations: number;
  /** true 表示因循环轮数上限被截断，返回了兜底话术 */
  capped: boolean;
};

const MAX_TOOL_RESULT_CHARS = 12_000;
const MAX_ITERATION_NOTICE =
  "这个问题需要的查询步骤太多，我先停在这里。建议把它拆成几个小问题（比如先问销售额，再问回款），我一条条帮你查清楚。";

function formatTerritories(user: McpUser) {
  if (user.viewScope === "ALL") return "全国（全量视图）";
  if (!user.territories?.length) return user.region || "未配置";
  return user.territories
    .map((territory) => `${territory.province}${territory.cities?.length ? `（${territory.cities.join("、")}）` : ""}`)
    .join("、");
}

export type XiaochuanAudienceMode = "staff" | "agent-account";

export function buildXiaochuanSystemPrompt(
  user: McpUser,
  tier: XiaochuanThinkingTier,
  config: XiaochuanConfig,
  processRulesSection = "",
  audienceMode: XiaochuanAudienceMode = "staff",
  hasExternalTools = false,
) {
  const now = new Date();
  const agentMode = audienceMode === "agent-account";
  const lines = [
    "你是「小川」，山东大川重工机床股份有限公司（大川机床）内部平台 DachuanPro 的 AI 助手。",
    "公司主营数控插床、数控插齿机、插床、刨床等机床设备。你的服务对象是公司内部员工。",
    ...(agentMode
      ? [
          `当前提问者：${user.name || "Agent 平台用户"}（Agent 平台访客账号）。`,
          "该账号未接入业务数据库：你没有合同、客户、回款、库存等业务数据的查询权限，也不要提及或尝试调用任何业务数据工具。",
          "你可以使用公司知识库工具（机型能力参数 / 工艺规则卡 / 数控程序模板）与计算工具（表达式计算 / 毛坯重量估算）回答产品、选型、程序与计算类问题，也可以直接回答通用问题。",
        ]
      : [
          `当前提问员工：${user.name || user.email || user.id}（角色：${user.role}；数据范围：${formatTerritories(user)}）。`,
          "你通过工具查询到的是该员工权限范围内的 DachuanPro 真实业务数据。",
        ]),
    "",
    "数据规则（必须遵守）：",
    "1. 涉及产品参数、工艺、程序等专业问题时，必须先调用知识库工具查询，再依据返回结果回答；",
    "2. 数字必须精确引用工具返回值，禁止估算、编造或使用训练记忆补数；",
    "3. 工具没查到就明确说没有查到，并建议用户换个问法；",
    "4. 面向用户说话时使用自然中文，不展示内部字段名、枚举值、ID 或 JSON 结构；",
    "5. 金额、数量等关键数字可适当汇总，但不得改变工具返回的事实。",
    "6. 凡涉及数字计算（求和、均值、百分比、换算、面积、体积等），必须调用表达式计算工具（dachuan_calc_expression）拿精确结果，禁止心算或目测估算；估算工件/毛坯重量时调用重量估算工具（dachuan_calc_part_weight），并说明结果是理论毛坯重量。",
    "",
    `公司产品线参考：数控插床（BK 系列）、数控插齿机（Y51 系列）、插齿插键复合机床、龙门五轴加工中心、数控键槽铣床、普通刨床、普通插床。涉及产品参数问题时，以工具查询结果为准。`,
    "",
    "机型选型与程序问答规范（必须遵守）：",
    "1. 凡涉及机型参数或「这个工件用什么机床加工」的问题，必须先调用机型参数工具查库；机床参数只能来自工具返回值，禁止凭记忆编造；",
    "2. 选型时只推荐合适的机型（可按匹配程度推荐 1~3 台），并逐一说明推荐原因，原因中的参数要引用查表结果；",
    "3. 不要输出「为什么不选某机型」之类的否定式分析——只讲推荐理由，对用户没有价值的排除式对比不必说；",
    "4. 工件特征符合工艺经验规则时，优先按规则推荐，并结合机型参数核对能力上限；",
    "5. 推荐选型后提醒用户：最终选型以技术部评审为准；",
    "6. 用户咨询插削程序写法时，先确认所用数控系统（广数 GSK / 凯恩帝 KND / 西门子），再调用程序模板工具取出对应模板，按图纸指出需要修改的参数值；模板中标注不可更改的部分保持默认。",
    "",
    "内容红线（必须遵守）：拒绝生成或讨论违反法律法规、政治敏感、色情、暴力、歧视等内容；遇到此类请求，礼貌拒绝并引导回工作话题。",
    "",
    ...(hasExternalTools
      ? [
          "外部信息工具（联网搜索、网页读取、企业信息、汇率查询等）：",
          "1. 涉及最新资讯、行业动态、公开网络信息、企业工商背景、汇率换算时，先调用对应外部工具查询，再依据返回结果回答；",
          "2. 引用网络信息时说明信息来自网络搜索，不确定的内容不要编造；",
          "3. 外部工具返回的是互联网公开信息，与平台业务数据无关，不得混入或冒充平台内部数据。",
          "",
        ]
      : []),
    "通用交流（不涉业务数据）可以直接回答，不必调用工具。",
  ];
  if (processRulesSection) {
    lines.push("", processRulesSection);
  }
  lines.push(
    "",
    `今天是 ${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日。`,
    "",
    config.tiers[tier].styleDirective,
  );
  return lines.join("\n");
}

function toolResultContent(outcome: AgentToolOutcome) {
  if (!outcome.ok) {
    return JSON.stringify({ ok: false, error: { code: outcome.errorCode, message: outcome.message } });
  }
  const payload = JSON.stringify({ ok: true, data: outcome.data });
  return payload.length > MAX_TOOL_RESULT_CHARS
    ? `${payload.slice(0, MAX_TOOL_RESULT_CHARS)}…（结果过长已截断，请缩小查询范围后重试）`
    : payload;
}

export async function runXiaochuanTurn(options: {
  config: XiaochuanConfig;
  tier: XiaochuanThinkingTier;
  user: McpUser;
  dataSource: McpDataSource;
  history: LlmMessage[];
  userMessage: string;
  /** 身份模式：staff=CRM 员工（默认），agent-account=Agent 独立账号（无业务工具，提示词换访客版） */
  audienceMode?: XiaochuanAudienceMode;
  /** Agent 独立账号 id：存在时工具审计写 agent_account_audit_logs */
  agentAccountId?: string;
  /** 工艺规则提示词段；不传则自动从知识库加载（测试可传空串绕开 DB） */
  processRulesSection?: string;
  /** 知识工具执行入口；不传则走真实知识库查询（测试可注入 mock） */
  knowledgeRunner?: KnowledgeToolRunner;
  /** 计算工具执行入口；不传则走本地计算（测试可注入 mock） */
  calculatorRunner?: CalculatorToolRunner;
  callbacks: {
    onDelta: (text: string) => void;
    /** 混合推理模型的思考内容增量（仅流式展示，不落库） */
    onReasoning: (text: string) => void;
    onToolEvent: (event: AgentToolEvent) => void;
  };
  signal?: AbortSignal;
}): Promise<AgentTurnResult> {
  const { config, tier, user, dataSource, history, userMessage, callbacks, signal } = options;
  const audienceMode = options.audienceMode ?? "staff";

  // 完整工具箱：内置（按角色过滤）+ 外部 MCP（联网搜索/网页读取/天眼查/汇率等，全员可用）；
  // 外部服务失联时自动降级为纯内置。
  const fullToolbox = await buildXiaochuanFullToolSpecs(user.role);
  const tools = fullToolbox.specs;
  const externalToolNames = new Set(fullToolbox.externalRegistrations.map((registration) => registration.exposedName));
  const processRulesSection = options.processRulesSection ?? (await loadProcessRulesSection());
  const baseMessages: LlmMessage[] = [
    { role: "system", content: buildXiaochuanSystemPrompt(user, tier, config, processRulesSection, audienceMode, fullToolbox.hasExternalTools) },
    ...history,
    { role: "user", content: userMessage },
  ];

  let promptTokens = 0;
  let completionTokens = 0;
  const toolEvents: AgentToolEvent[] = [];
  let iterations = 0;

  for (let iteration = 1; iteration <= config.maxToolIterations; iteration += 1) {
    if (signal?.aborted) throw new AgentTimeoutError();
    iterations = iteration;

    // 第 1 轮按用户所选档位思考；工具调用后的续轮统一关闭深度思考——
    // 硅基流动 K2.6 在“思考开启 + 回填含工具调用的历史”时会不稳定地报 20015
    // （reasoning_content 缺失校验），且拿到工具结果后的合成回答并不需要再思考。
    const tierProfile = iteration === 1
      ? config.tiers[tier]
      : { ...config.tiers[tier], enableThinking: false };

    let turnContent = "";
    let turnFinishReason: string | null = null;
    let turnToolCalls: Array<{ id: string; name: string; arguments: string }> = [];
    let turnDone = false;

    const timeoutSignal = AbortSignal.timeout(config.requestTimeoutMs);
    const callSignal = signal
      ? (AbortSignal.any ? AbortSignal.any([signal, timeoutSignal]) : signal)
      : timeoutSignal;

    try {
      for await (const event of streamXiaochuanChat({
        config,
        tierProfile,
        messages: baseMessages,
        tools,
        signal: callSignal,
      })) {
        if (event.type === "delta") {
          turnContent += event.text;
          callbacks.onDelta(event.text);
        } else if (event.type === "reasoning") {
          callbacks.onReasoning(event.text);
        } else if (event.type === "tool_calls") {
          turnToolCalls = event.calls;
        } else if (event.type === "done") {
          turnDone = true;
          turnFinishReason = event.finishReason;
          promptTokens += event.promptTokens ?? 0;
          completionTokens += event.completionTokens ?? 0;
        }
      }
    } catch (error) {
      if (error instanceof LlmUpstreamError) throw error;
      if (signal?.aborted || (error instanceof Error && error.name === "TimeoutError")) throw new AgentTimeoutError();
      if (error instanceof Error && error.name === "AbortError") throw new AgentTimeoutError();
      throw error;
    }
    if (!turnDone && turnToolCalls.length === 0 && !turnContent) {
      throw new LlmUpstreamError(502, "AI 服务返回了空响应");
    }

    if (turnToolCalls.length === 0) {
      // K2.6 的 reasoning_content 计入 max_tokens：思考过长时正文可能被 max_tokens 截断为空
      // （finish_reason=length 且无正文、无工单），静默返回空气泡不如给出明确指引（2026-09-11 实测）
      let finalContent = turnContent;
      if (!finalContent.trim() && turnFinishReason === "length") {
        finalContent =
          "这轮深度思考占满了输出额度，正文没来得及生成。请再问一次（长思考有随机性，重试多半能出），或改用「陷入沉思」/「小川快跑」档。";
      }
      return {
        content: finalContent,
        promptTokens,
        completionTokens,
        toolEvents,
        iterations,
        capped: false,
      };
    }

    // 有工单：只执行允许清单内的工具（内置白名单 + 本回合外部注册表；白名单外直接回执拒绝，不让大脑重试）
    const isAllowedTool = (name: string) => fullToolbox.allowedNames.includes(name);
    const safeCalls = turnToolCalls.filter((call) => isAllowedTool(call.name));
    const rejectedCalls = turnToolCalls.filter((call) => !isAllowedTool(call.name));
    const assistantMessage: LlmMessage = {
      role: "assistant",
      content: turnContent || null,
      tool_calls: turnToolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    };
    baseMessages.push(assistantMessage);

    for (const call of rejectedCalls) {
      baseMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify({ ok: false, error: { code: "TOOL_NOT_ALLOWED", message: "该工具不在小川工具箱内" } }),
      });
    }

    for (const call of safeCalls) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
      } catch {
        parsedArgs = {};
      }
      const outcome = await executeAgentTool({
        dataSource,
        user,
        toolName: call.name,
        args: parsedArgs,
        externalRegistrations: fullToolbox.externalRegistrations,
        ...(options.agentAccountId ? { agentAccountId: options.agentAccountId } : {}),
        ...(options.knowledgeRunner ? { knowledgeRunner: options.knowledgeRunner } : {}),
        ...(options.calculatorRunner ? { calculatorRunner: options.calculatorRunner } : {}),
      });
      const event: AgentToolEvent = { tool: call.name, ok: outcome.ok, durationMs: outcome.durationMs };
      toolEvents.push(event);
      callbacks.onToolEvent(event);
      baseMessages.push({ role: "tool", tool_call_id: call.id, content: toolResultContent(outcome) });
    }
  }

  return {
    content: MAX_ITERATION_NOTICE,
    promptTokens,
    completionTokens,
    toolEvents,
    iterations,
    capped: true,
  };
}

export function tierLabel(tier: XiaochuanThinkingTier) {
  return XIAOCHUAN_TIER_LABELS[tier];
}
