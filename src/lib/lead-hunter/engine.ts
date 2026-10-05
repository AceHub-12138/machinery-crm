/**
 * 获客执行引擎：任务创建后服务端异步执行（fire-and-forget，状态落库，前端轮询）。
 * 不做后台队列（单实例部署、量小）：服务重启会中断进行中的任务，
 * 由 markInterruptedIfStale 按 updatedAt 心跳超时兜底标 failed，页面允许"重新执行"。
 * 每轮循环：关键词生成/迭代 → 千帆搜索 → AI 抽取评分 → 去重 → 落候选；AUTO 模式尾部自动天眼查反查。
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { resolveXiaochuanRuntimeConfig } from "@/lib/agent/model-config-store";
import { companyDedupKey, normalizedCompanyName } from "@/lib/lead-hunter/dedup";
import { createLlmCaller, type LlmCaller } from "@/lib/lead-hunter/llm";
import { analyzeLead, extractKeywords, keywordPlannerPrompt } from "@/lib/lead-hunter/prompts";
import { createFakeSearchClient, createQianfanSearchClient, type SearchClient, type WebSearchResult } from "@/lib/lead-hunter/qianfan";
import { createTianyanchaClient, type TianyanchaClient } from "@/lib/lead-hunter/tianyancha";
import { emptyProgress, emptyReport, type LeadHuntTaskConfig, type TaskProgress, type TaskReport } from "@/lib/lead-hunter/types";

export type LeadHunterDeps = {
  prisma: PrismaClient;
  search?: SearchClient;
  tianyancha?: TianyanchaClient;
  llm?: LlmCaller;
  now?: () => Date;
};

class TaskCancelled extends Error {
  constructor() {
    super("任务已取消");
  }
}

// 进程内运行态：防同任务并发执行 + 支持取消。globalThis 挂载以免 dev 热重载丢引用。
const runtimeHolder = globalThis as unknown as { __leadHunterRuntime?: Map<string, AbortController> };
function runtime() {
  runtimeHolder.__leadHunterRuntime ??= new Map<string, AbortController>();
  return runtimeHolder.__leadHunterRuntime;
}

/** running 任务超过该心跳间隔且不在本进程运行，视为服务重启导致的中断 */
export const STALE_RUNNING_MS = 3 * 60 * 1000;

type ScoredItem = { item: WebSearchResult; keyword: string };

export function createLeadHunterEngine(deps: LeadHunterDeps) {
  const prisma = deps.prisma;
  const now = deps.now ?? (() => new Date());
  // 每轮低分原因缓冲（供下一轮关键词迭代参考）
  const lowScoreReasonBuffer: string[] = [];

  function searchClient(): SearchClient {
    if (deps.search) return deps.search;
    // 演示/本地联调用假搜索：不花千帆额度（上线包环境变量不含此项，默认走真实搜索）
    if (process.env.LEAD_HUNTER_FAKE_SEARCH?.trim() === "1") return createFakeSearchClient();
    return createQianfanSearchClient();
  }

  function tianyanchaClient(): TianyanchaClient {
    return deps.tianyancha ?? createTianyanchaClient({ now });
  }

  async function llmCaller(): Promise<LlmCaller> {
    if (deps.llm) return deps.llm;
    return createLlmCaller(await resolveXiaochuanRuntimeConfig());
  }

  /** 详情页轮询时兜底：running 且长时间无心跳（服务重启）→ 标 failed 允许重新执行 */
  async function markInterruptedIfStale(taskId: string) {
    const task = await prisma.leadHuntTask.findUnique({ where: { id: taskId }, select: { status: true, updatedAt: true } });
    if (!task || task.status !== "running") return;
    if (runtime().has(taskId)) return;
    if (Date.now() - task.updatedAt.getTime() < STALE_RUNNING_MS) return;
    await prisma.leadHuntTask.update({
      where: { id: taskId },
      data: { status: "failed", error: "服务重启导致任务中断，可重新执行" },
    });
  }

  async function runTask(taskId: string): Promise<void> {
    if (runtime().has(taskId)) return;
    const task = await prisma.leadHuntTask.findUnique({ where: { id: taskId } });
    if (!task || task.status !== "running") return;

    const config = task.config as unknown as LeadHuntTaskConfig;
    const controller = new AbortController();
    runtime().set(taskId, controller);
    const aborted = () => controller.signal.aborted;
    const checkAborted = () => {
      if (aborted()) throw new TaskCancelled();
    };

    const progress: TaskProgress = emptyProgress(config);
    const report: TaskReport = emptyReport(task.createdAt.toISOString());
    const touch = () => prisma.leadHuntTask.update({ where: { id: taskId }, data: { progress, report } });

    try {
      const llm = await llmCaller();
      const search = searchClient();
      const tianyancha = tianyanchaClient();

      const seenUrls = new Set<string>();
      const seenCompanies = new Set<string>();
      const usedQueries: string[] = [];
      let currentKeywords: string[] = [];

      for (let round = 1; round <= config.maxRounds; round++) {
        checkAborted();
        progress.currentRound = round;
        progress.phase = "keywords";

        // 1. 关键词生成/迭代：第 1 轮必生成；其后在迭代预算内按上一轮质量优化，失败沿用上一轮
        const shouldPlan = round === 1 || round - 1 <= config.keywordIterations;
        if (shouldPlan) {
          const lastSummary = progress.roundSummaries[progress.roundSummaries.length - 1] ?? null;
          try {
            const prompt = keywordPlannerPrompt(config.goal, round, lastSummary && round > 1
              ? { summary: lastSummary, lowScoreReasons: lowScoreReasonBuffer, usedQueries }
              : null);
            currentKeywords = extractKeywords(await llm(prompt));
          } catch (error) {
            if (round === 1) throw error instanceof Error ? error : new Error("关键词生成失败");
            // 迭代轮 LLM 失败（已内部重试 1 次）：沿用上一轮关键词继续
          }
        }
        progress.currentKeywords = [...currentKeywords];
        for (const keyword of currentKeywords) {
          if (!usedQueries.includes(keyword)) usedQueries.push(keyword);
        }
        await touch();

        // 2. 搜索：每个关键词取 pagesPerRound 条，无效结果过滤 + URL 去重（语义照抄原 n8n）
        progress.phase = "searching";
        await touch();
        const roundItems: ScoredItem[] = [];
        for (const keyword of currentKeywords) {
          checkAborted();
          const results = await search.searchWeb(keyword, config.pagesPerRound);
          for (const item of results) {
            if (!item.title.trim() || !item.url.trim() || !item.content.trim()) continue;
            const normalizedUrl = item.url.replace(/#.*$/, "").replace(/\/$/, "");
            if (seenUrls.has(normalizedUrl)) continue;
            seenUrls.add(normalizedUrl);
            roundItems.push({ item, keyword });
          }
        }

        // 3-5. 逐条 AI 抽取+评分，任务内与线索池双重去重后落候选
        progress.phase = "scoring";
        await touch();
        let roundCandidates = 0;
        let roundQualified = 0;
        let roundParseFailed = 0;
        lowScoreReasonBuffer.length = 0;

        for (const scored of roundItems) {
          checkAborted();
          let analysis;
          try {
            analysis = await analyzeLead(llm, { goal: config.goal, keyword: scored.keyword, item: scored.item });
          } catch {
            roundParseFailed += 1;
            continue; // AI 解析失败不入池（对齐原 n8n REJECTED_AI_PARSE 语义），仅计入统计
          }
          if (!analysis.isCompany || !analysis.companyName) {
            roundParseFailed += 1;
            continue;
          }
          const normalized = normalizedCompanyName(analysis.companyName);
          if (seenCompanies.has(normalized)) continue;
          seenCompanies.add(normalized);
          const existing = await prisma.lead.findFirst({
            where: { OR: [{ dedupKey: companyDedupKey(analysis.companyName) }, { companyName: { contains: analysis.companyName } }] },
            select: { id: true },
          });
          if (existing) continue;

          const qualified = analysis.aiScore >= config.passingScore;
          const status = qualified ? (analysis.phone ? "PENDING_CONFIRM" : "NO_CONTACT") : "DISCARDED";
          await prisma.leadHuntCandidate.create({
            data: {
              taskId,
              companyName: analysis.companyName,
              sourceUrl: scored.item.url.slice(0, 2048),
              snippet: (scored.item.snippet || scored.item.content).slice(0, 5000),
              keywords: currentKeywords,
              round,
              score: analysis.aiScore,
              scoreReason: analysis.scoreReason,
              phone: analysis.phone,
              email: analysis.email,
              province: analysis.province || null,
              city: analysis.city || null,
              status,
            },
          });
          roundCandidates += 1;
          report.totalCandidates += 1;
          if (qualified) {
            roundQualified += 1;
          } else {
            report.discarded += 1;
            if (analysis.scoreReason) lowScoreReasonBuffer.push(analysis.scoreReason);
          }
          await touch();
        }

        progress.roundSummaries.push({
          round,
          keywords: [...currentKeywords],
          candidates: roundCandidates,
          qualified: roundQualified,
          parseFailed: roundParseFailed,
        });
        await touch();
      }

      // 6. AUTO 模式尾部自动反查（受每日上限护栏约束；MANUAL 模式留给用户勾选）
      if (config.lookupMode === "AUTO" && config.dailyLookupLimit > 0) {
        progress.phase = "lookup";
        await touch();
        const pending = await prisma.leadHuntCandidate.findMany({
          where: { taskId, status: "NO_CONTACT" },
          orderBy: [{ score: "desc" }, { createdAt: "asc" }],
        });
        for (const candidate of pending) {
          checkAborted();
          if (tianyancha.todayCallCount() >= config.dailyLookupLimit) break;
          report.lookupCalls += 1;
          await prisma.leadHuntCandidate.update({ where: { id: candidate.id }, data: { status: "LOOKING_UP" } });
          const lookup = await tianyancha.lookupCompany(candidate.companyName);
          await prisma.leadHuntCandidate.update({
            where: { id: candidate.id },
            data: {
              status: lookup.found && lookup.phone ? "LOOKUP_FOUND" : "LOOKUP_FAILED",
              tianyancha: lookup.raw as Prisma.InputJsonValue,
              ...(lookup.phone ? { phone: lookup.phone } : {}),
            },
          });
          await touch();
        }
      }

      progress.phase = "done";
      report.finishedAt = now().toISOString();
      await prisma.leadHuntTask.update({ where: { id: taskId }, data: { status: "done", progress, report, error: null } });
    } catch (error) {
      const finishedAt = now().toISOString();
      if (aborted()) {
        await prisma.leadHuntTask.updateMany({
          where: { id: taskId, status: "running" },
          data: { status: "cancelled", progress, report: { ...report, finishedAt }, error: "用户取消" },
        });
      } else {
        const message = error instanceof Error ? error.message : "未知错误";
        console.error(`[lead-hunter] 任务 ${taskId} 失败：${message}`);
        await prisma.leadHuntTask.update({
          where: { id: taskId },
          data: { status: "failed", error: message.slice(0, 190), progress, report: { ...report, finishedAt } },
        });
      }
    } finally {
      runtime().delete(taskId);
    }
  }

  return {
    /** fire-and-forget 启动（API 层用）：错误已在 runTask 内部落库，这里只兜日志 */
    startTask(taskId: string) {
      void runTask(taskId).catch((error) => console.error("[lead-hunter] 任务执行异常", error));
    },
    runTask,
    /** 取消：DB 先标 cancelled（轮询立即可见），再 abort 让引擎尽快退出且不覆盖状态 */
    async cancelTask(taskId: string): Promise<boolean> {
      const controller = runtime().get(taskId);
      if (!controller) return false;
      await prisma.leadHuntTask.updateMany({ where: { id: taskId, status: "running" }, data: { status: "cancelled" } });
      controller.abort();
      return true;
    },
    markInterruptedIfStale,
  };
}
