import type { Prisma, PrismaClient } from "@prisma/client";
import {
  KNOWLEDGE_MACHINE_SEARCH,
  KNOWLEDGE_NC_PROGRAM,
  KNOWLEDGE_PROCESS_RULES,
} from "@/lib/agent/knowledge/tools";

/**
 * 小川知识库查询实现：机型能力参数 / 工艺规则卡 / 数控程序模板。
 *
 * 全部只读 findMany；查询函数与 prisma 实例解耦（便于测试注入），
 * runKnowledgeTool 是生产入口（惰性加载 prisma，避免无关模块连带建连）。
 */

/** 提示词里最多注入的工艺规则条数（知识库设计约定：精华 ≤20 条进提示词） */
export const MAX_PROMPT_PROCESS_RULES = 20;

/** 机型清单模式下每行的摘要字段（防止多行返回撑爆工具结果 12k 截断） */
const MACHINE_SUMMARY_FIELDS = {
  category: true,
  model: true,
  fullName: true,
  mainObjects: true,
  maxStrokeText: true,
  maxStrokeLengthMm: true,
  maxModuleMm: true,
  maxOuterGearDiaMm: true,
  powerText: true,
  notSuitableText: true,
} satisfies Prisma.MachineCapabilitySelect;

export type KnowledgeDb = Pick<PrismaClient, "machineCapability" | "processRuleCard" | "ncProgramTemplate">;

export async function searchMachineCapabilities(db: KnowledgeDb, args: Record<string, unknown>) {
  const {
    model,
    category,
    keyword,
    minStrokeLengthMm,
    maxModuleMm,
    maxOuterGearDiaMm,
    limit,
  } = args as {
    model?: string;
    category?: string;
    keyword?: string;
    minStrokeLengthMm?: number;
    maxModuleMm?: number;
    maxOuterGearDiaMm?: number;
    limit?: number;
  };

  const and: Prisma.MachineCapabilityWhereInput[] = [];
  // 型号列存在一行多型号（如 B5032/B5040），用 contains 片段匹配
  if (model) and.push({ model: { contains: model } });
  if (category) and.push({ category: { contains: category } });
  if (keyword) {
    and.push({
      OR: [
        { mainObjects: { contains: keyword } },
        { fullName: { contains: keyword } },
        { optionsText: { contains: keyword } },
      ],
    });
  }
  if (typeof minStrokeLengthMm === "number") and.push({ maxStrokeLengthMm: { gte: minStrokeLengthMm } });
  if (typeof maxModuleMm === "number") and.push({ maxModuleMm: { gte: maxModuleMm } });
  if (typeof maxOuterGearDiaMm === "number") and.push({ maxOuterGearDiaMm: { gte: maxOuterGearDiaMm } });

  const where: Prisma.MachineCapabilityWhereInput = and.length ? { AND: and } : {};
  // 指定型号 = 详情查询返回全字段；否则清单模式只回摘要字段
  const isDetailLookup = Boolean(model) && and.length === 1;
  const take = limit ?? 10;

  const rows = await db.machineCapability.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }],
    take,
    ...(isDetailLookup ? {} : { select: MACHINE_SUMMARY_FIELDS }),
  });

  const total = await db.machineCapability.count({ where });
  return {
    total,
    returned: rows.length,
    hint: isDetailLookup
      ? undefined
      : "如需某台机型的完整参数（行程、承重、外形尺寸、选配等），用 model 参数单独查询该型号",
    machines: rows,
  };
}

export async function listProcessRules(db: KnowledgeDb, limit = MAX_PROMPT_PROCESS_RULES) {
  const [rows, total] = await Promise.all([
    db.processRuleCard.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: "asc" }],
      take: limit,
    }),
    db.processRuleCard.count({ where: { enabled: true } }),
  ]);
  return { total, returned: rows.length, rules: rows };
}

export async function getNcProgramTemplates(db: KnowledgeDb, args: Record<string, unknown>) {
  const { system, keyword } = args as { system: string; keyword?: string };
  const where: Prisma.NcProgramTemplateWhereInput = {
    system,
    ...(keyword ? { name: { contains: keyword } } : {}),
  };
  const rows = await db.ncProgramTemplate.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }],
  });
  return { total: rows.length, returned: rows.length, templates: rows };
}

/** 生产入口：按工具名分发查询。executor 传来的参数已过 Zod 校验。 */
export async function runKnowledgeTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const { prisma } = await import("@/lib/db");
  switch (toolName) {
    case KNOWLEDGE_MACHINE_SEARCH:
      return searchMachineCapabilities(prisma, args);
    case KNOWLEDGE_PROCESS_RULES:
      return listProcessRules(prisma);
    case KNOWLEDGE_NC_PROGRAM:
      return getNcProgramTemplates(prisma, args);
    default:
      throw new Error(`未知知识工具：${toolName}`);
  }
}

// ---------- 提示词注入 ----------

/** 把启用的工艺规则格式化为系统提示词段落（空规则库返回空串，不占提示词） */
export function formatProcessRulesSection(rules: Awaited<ReturnType<typeof listProcessRules>>["rules"]): string {
  if (!rules.length) return "";
  const lines = rules.map((rule) => {
    const parts = [
      `${rule.ruleNo}. 当 ${rule.conditionText}`,
      `推荐机型=${rule.recommendModels}`,
      rule.recommendProcess ? `工艺建议=${rule.recommendProcess}` : "",
      rule.notRecommended ? `不推荐/禁止=${rule.notRecommended}` : "",
      rule.rationale ? `依据=${rule.rationale}` : "",
    ].filter(Boolean);
    return parts.join("；");
  });
  return [
    "工艺选型经验规则（工艺师傅整理，选型时优先遵循）：",
    ...lines,
  ].join("\n");
}

/** 每轮对话加载工艺规则段；知识库不可用时静默降级为空段，不阻断对话 */
export async function loadProcessRulesSection(): Promise<string> {
  try {
    const { prisma } = await import("@/lib/db");
    const { rules } = await listProcessRules(prisma, MAX_PROMPT_PROCESS_RULES);
    return formatProcessRulesSection(rules);
  } catch (error) {
    console.error("[xiaochuan] 工艺规则加载失败（对话继续，不含规则段）", error);
    return "";
  }
}
