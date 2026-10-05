import { createPrismaMcpDataSource } from "@/lib/mcp/prisma-data-source";
import {
  parseXiaochuanThinkingTier,
  type XiaochuanThinkingTier,
} from "@/lib/agent/config";
import { getXiaochuanViewer, agentAccountToMcpUser } from "@/lib/agent/auth";
import { resolveXiaochuanRuntimeConfig } from "@/lib/agent/model-config-store";
import { consumeAgentDailyQuota } from "@/lib/agent/daily-quota";
import { checkXiaochuanRateLimit } from "@/lib/agent/rate-limit";
import { runXiaochuanTurn } from "@/lib/agent/engine";
import { buildAttachmentContextNote, parseChatAttachments } from "@/lib/agent/attachments";
import { analyzeAttachmentsForTurn } from "@/lib/agent/vision";
import { LlmUpstreamError } from "@/lib/agent/llm-client";
import { prisma } from "@/lib/db";
import type { McpUser } from "@/lib/mcp/application";
import type { LlmMessage } from "@/lib/agent/llm-client";

export const dynamic = "force-dynamic";

function sseData(controller: ReadableStreamDefaultController, payload: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
}

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  // 双身份：CRM 员工（NextAuth 会话）或 Agent 独立账号（独立 Cookie）
  const viewer = await getXiaochuanViewer();
  if (!viewer) return jsonError(401, "请先登录");

  let config;
  try {
    // 模型配置：Agent 管理·模型配置存库生效时优先用库里的，否则回落 .env
    config = await resolveXiaochuanRuntimeConfig();
  } catch (error) {
    return jsonError(503, error instanceof Error ? `小川服务未配置：${error.message}` : "小川服务未配置");
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > config.maxRequestBytes) return jsonError(413, "请求内容过大");

  let body: { conversationId?: unknown; message?: unknown; thinkingTier?: unknown; attachments?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "请求格式无效");
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return jsonError(400, "请输入你想问的问题");
  if (message.length > 4_000) return jsonError(400, "问题太长了，请精简到 4000 字以内");
  const tier: XiaochuanThinkingTier = parseXiaochuanThinkingTier(body.thinkingTier);

  // 附件（段 2：存得下看得见；解析在段 3/4 接入）。先上传拿到 url 的附件在这里校验并落库；
  // 归属校验：附件路径必须属于当前对话者本人（CRM 员工 / Agent 独立账号）。
  const attachmentOwner = viewer.kind === "agent-account"
    ? { kind: "agent-account" as const, id: viewer.account.id }
    : { kind: "crm" as const, id: viewer.user.id };
  const parsedAttachments = parseChatAttachments(body.attachments, attachmentOwner);
  if (!parsedAttachments.ok) return jsonError(400, parsedAttachments.error);
  const attachments = parsedAttachments.attachments;

  // 身份拆分：CRM 员工沿用角色化数据工具；Agent 独立账号走每日额度 + 知识工具
  const rateKey = viewer.kind === "agent-account" ? `agent:${viewer.account.id}` : viewer.user.id;
  const rate = checkXiaochuanRateLimit(rateKey, config.rateLimitPerMinute);
  if (!rate.allowed) {
    return Response.json(
      { error: `提问太频繁了，请 ${rate.retryAfterSeconds} 秒后再试` },
      { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds) } },
    );
  }

  const dataSource = createPrismaMcpDataSource(prisma);
  let engineUser: McpUser;
  let conversationOwnerWhere: { agentAccountId: string } | { userId: string };
  let agentAccountId: string | undefined;
  if (viewer.kind === "agent-account") {
    const account = viewer.account;
    const quota = await consumeAgentDailyQuota(prisma, account.id, account.dailyQuota);
    if (!quota.allowed) {
      return Response.json(
        { error: `今日提问额度已用完（每天 ${quota.quota} 问），明天再来找小川聊吧` },
        { status: 429, headers: { "retry-after": "3600" } },
      );
    }
    engineUser = agentAccountToMcpUser(account);
    conversationOwnerWhere = { agentAccountId: account.id };
    agentAccountId = account.id;
  } else {
    const findUser = dataSource.findUser?.bind(dataSource);
    if (!findUser) return jsonError(503, "小川数据源不可用");
    const found = await findUser(viewer.user.id);
    if (!found || found.isActive === false) return jsonError(403, "账号不可用");
    engineUser = found;
    conversationOwnerWhere = { userId: viewer.user.id };
  }

  // 会话归属校验：只允许访问自己的对话（CRM 员工与 Agent 账号两列各查各的）
  let conversationId: string;
  if (typeof body.conversationId === "string" && body.conversationId.trim()) {
    const conversation = await prisma.agentConversation.findUnique({
      where: { id: body.conversationId.trim() },
      select: { id: true, userId: true, agentAccountId: true },
    });
    const owned = conversation && (
      agentAccountId
        ? conversation.agentAccountId === agentAccountId
        : conversation.userId === engineUser.id
    );
    if (!owned) return jsonError(404, "对话不存在");
    conversationId = conversation.id;
  } else {
    const created = await prisma.agentConversation.create({
      data: { ...conversationOwnerWhere, title: message.slice(0, 24), thinkingTier: tier },
      select: { id: true },
    });
    conversationId = created.id;
  }

  const historyRows = await prisma.agentMessage.findMany({
    where: { conversationId, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "desc" },
    take: config.historyMessageLimit,
    select: { role: true, content: true },
  });
  const history: LlmMessage[] = historyRows
    .reverse()
    .map((row) => ({ role: row.role === "assistant" ? "assistant" : "user", content: row.content }) as LlmMessage);

  const userMessage = await prisma.agentMessage.create({
    data: {
      conversationId,
      role: "user",
      content: message,
      attachments: attachments.length > 0 ? attachments : undefined,
    },
    select: { id: true, createdAt: true },
  });

  const conversationStartedAt = Date.now();

  // 段 3：图片走视觉模型读图、PDF 提取文字（CAD 段 4）；失败自动降级为"看不到内容"注记。
  // 附件分析有自己的 visionTimeout 保护，先于整体超时窗口执行——否则多页图纸会把
  // overallTimeoutMs 窗口吃光，导致后面引擎刚起步就被判超时（2026-09-11 用户实测踩坑）。
  const attachmentNote = attachments.length > 0 ? await analyzeAttachmentsForTurn(attachments, config) : "";
  const attachmentFallback = buildAttachmentContextNote(attachments);
  const attachmentContext = attachmentNote || attachmentFallback;

  const overallSignal = AbortSignal.timeout(config.overallTimeoutMs);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const closeStream = () => {
        try {
          controller.close();
        } catch {
          // 流已被客户端断开，忽略
        }
      };
      try {
        sseData(controller, { type: "meta", conversationId, userMessageId: userMessage.id, tier });
        const result = await runXiaochuanTurn({
          config,
          tier,
          user: engineUser,
          dataSource,
          history,
          audienceMode: agentAccountId ? "agent-account" : "staff",
          ...(agentAccountId ? { agentAccountId } : {}),
          // 附件分析注记只进模型上下文，落库与历史回放仍用用户原文
          userMessage: attachmentContext ? `${message}\n\n${attachmentContext}` : message,
          callbacks: {
            onDelta: (text) => {
              if (text) sseData(controller, { type: "delta", text });
            },
            onReasoning: (text) => {
              // 思考内容仅流式展示，不落库（历史回放不含思考过程）
              if (text) sseData(controller, { type: "reasoning", text });
            },
            onToolEvent: (event) => {
              sseData(controller, { type: "tool", tool: event.tool, ok: event.ok, durationMs: event.durationMs });
            },
          },
          signal: overallSignal,
        });

        const durationMs = Date.now() - conversationStartedAt;
        const assistantMessage = await prisma.agentMessage.create({
          data: {
            conversationId,
            role: "assistant",
            content: result.content,
            thinkingTier: tier,
            toolSummary: result.toolEvents.length > 0
              ? result.toolEvents.map((event) => ({ tool: event.tool, ok: event.ok, durationMs: event.durationMs }))
              : undefined,
            promptTokens: result.promptTokens || undefined,
            completionTokens: result.completionTokens || undefined,
            durationMs,
          },
          select: { id: true },
        });
        await prisma.agentConversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date(), thinkingTier: tier },
        });

        sseData(controller, {
          type: "done",
          messageId: assistantMessage.id,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          durationMs,
          capped: result.capped,
        });
        closeStream();
      } catch (error) {
        const isTimeout = error instanceof Error && error.name === "AgentTimeoutError";
        const isUpstream = error instanceof LlmUpstreamError;
        const message = isTimeout
          ? (error as Error).message
          : isUpstream
            ? error.message
            : "小川走神了一下，请重新提问试试";
        const code = isTimeout ? "AGENT_TIMEOUT" : isUpstream ? "LLM_UPSTREAM" : "INTERNAL_ERROR";
        // 报错也落库：重新进入历史对话时错误信息不丢失
        try {
          const durationMs = Date.now() - conversationStartedAt;
          const errorMessage = await prisma.agentMessage.create({
            data: {
              conversationId,
              role: "assistant",
              content: message,
              thinkingTier: tier,
              error: true,
              durationMs,
            },
            select: { id: true },
          });
          await prisma.agentConversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date(), thinkingTier: tier },
          });
          sseData(controller, { type: "done", messageId: errorMessage.id, error: true });
        } catch {
          // 落库失败时仍要把错误推给前端
        }
        sseData(controller, { type: "error", code, message });
        closeStream();
      }
    },
    cancel() {
      // 客户端断开时，AbortSignal.timeout 的总体控制器仍会让引擎尽快停下
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
