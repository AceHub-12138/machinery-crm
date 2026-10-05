import { z } from "zod/v4";

/**
 * 小川内置知识工具（第 2 期段 1）：机型能力参数 / 工艺规则卡 / 数控程序模板。
 *
 * 与 MCP 业务只读工具的区别：数据来源是平台知识库表（只读查询，无角色隔离），
 * 全员可用的拍板依据与对话一致——知识库不含客户/合同等敏感业务数据。
 * 执行纪律与 MCP 完全一致：Zod 严格校验 + 逐次写审计 + 审计失败不交付结果。
 */

export const KNOWLEDGE_MACHINE_SEARCH = "dachuan_knowledge_machine_search";
export const KNOWLEDGE_PROCESS_RULES = "dachuan_knowledge_process_rules";
export const KNOWLEDGE_NC_PROGRAM = "dachuan_knowledge_nc_program";

export type KnowledgeToolDefinition = {
  name: string;
  title: string;
  description: string;
  schema: z.ZodTypeAny;
};

const machineSearchSchema = z
  .object({
    model: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .optional()
      .describe("按型号查询，如 BK5040、Y5125A、B5032，支持片段匹配；指定后返回该机型完整参数"),
    category: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .optional()
      .describe("按机型大类筛选：数控插床 / 数控插齿机 / 插齿插键复合机床 / 五轴加工中心 / 数控键槽铣床 / 普通刨床 / 普通插床"),
    keyword: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .optional()
      .describe("按加工能力关键词筛选，如：键槽、内齿、花键、齿轮、平面、阀门"),
    minStrokeLengthMm: z
      .number()
      .positive()
      .max(100_000)
      .optional()
      .describe("工件所需的最大插削/刨削长度（mm），用于筛选能力达标的插床/刨床类机型"),
    maxModuleMm: z
      .number()
      .positive()
      .max(1_000)
      .optional()
      .describe("工件模数（mm），用于筛选最大模数达标的插齿机"),
    maxOuterGearDiaMm: z
      .number()
      .positive()
      .max(100_000)
      .optional()
      .describe("工件外齿直径（mm），用于筛选可加工的插齿机"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe("返回条数上限，默认 10；不带筛选条件查全量清单时建议传 30"),
  })
  .strict();

const processRulesSchema = z.object({}).strict();

const ncProgramSchema = z
  .object({
    system: z
      .enum(["GSK", "KND", "SIEMENS"])
      .describe("数控系统：GSK=广数，KND=凯恩帝，SIEMENS=西门子"),
    keyword: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .optional()
      .describe("按模板名关键词筛选，如：拼刀、任意角度；不填返回该系统全部模板"),
  })
  .strict();

export const KNOWLEDGE_TOOL_DEFINITIONS: readonly KnowledgeToolDefinition[] = [
  {
    name: KNOWLEDGE_MACHINE_SEARCH,
    title: "查询机型能力参数",
    description:
      "查询大川机型能力参数库（覆盖在产全部机型）。按型号查完整参数、按工件特征（插削长度/模数/外齿直径/关键词）筛选可加工机型，或不带条件拉取全机型清单。凡涉及机型参数、工件选型推荐的问题，必须先调用本工具，禁止凭记忆回答参数。",
    schema: machineSearchSchema,
  },
  {
    name: KNOWLEDGE_PROCESS_RULES,
    title: "查询工艺选型规则",
    description:
      "查询工艺师傅整理的选型经验规则卡（工件特征 → 推荐机型与工艺方式）。为工件推荐机型时，除查机型参数外应调用本工具交叉核对师傅经验。",
    schema: processRulesSchema,
  },
  {
    name: KNOWLEDGE_NC_PROGRAM,
    title: "查询数控插削程序模板",
    description:
      "查询数控插床基础插削程序模板（按数控系统区分：GSK 广数 / KND 凯恩帝 / SIEMENS 西门子），含标准插削、拼刀插削、任意角度插削等模板及参数说明。用户咨询插削程序怎么写时调用。",
    schema: ncProgramSchema,
  },
];

export function isKnowledgeTool(name: string): boolean {
  return KNOWLEDGE_TOOL_DEFINITIONS.some((definition) => definition.name === name);
}

export function getKnowledgeToolDefinition(name: string): KnowledgeToolDefinition | null {
  return KNOWLEDGE_TOOL_DEFINITIONS.find((definition) => definition.name === name) ?? null;
}
