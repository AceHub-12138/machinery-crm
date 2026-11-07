import { z } from "zod";

/** AI 获客助手：任务配置、候选状态、进度与报告类型（配套 lead_hunt_* 两张表）。 */

export const LEAD_ADMIT_MIN_SCORE = 85;

export const leadHuntConfigSchema = z.object({
  goal: z.string().trim().min(5, "目标客户描述至少 5 个字").max(2000),
  maxRounds: z.number().int().min(1).max(5).default(3),
  pagesPerRound: z.number().int().min(1).max(10).default(3),
  keywordIterations: z.number().int().min(0).max(3).default(2),
});
export type LeadHuntTaskConfig = z.infer<typeof leadHuntConfigSchema>;

export const TASK_STATUSES = ["running", "done", "failed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const CANDIDATE_STATUS_LABELS = {
  ALREADY_IN_POOL: "已在线索池",
  EXISTING_CUSTOMER: "已是客户",
  PENDING_CONFIRM: "待确认",
  ADMITTED: "已入池",
  NO_CONTACT: "无联系方式-待反查",
  LOOKING_UP: "反查中",
  LOOKUP_FOUND: "反查成功",
  LOOKUP_FAILED: "反查无果",
  DISCARDED: "低分归档",
} as const;
export type CandidateStatus = keyof typeof CANDIDATE_STATUS_LABELS;

export type RoundSummary = {
  round: number;
  keywords: string[];
  candidates: number;
  qualified: number;
  parseFailed: number;
  searchFailed?: number;
  note?: string;
};

export type TaskProgress = {
  currentRound: number;
  totalRounds: number;
  phase: "keywords" | "searching" | "scoring" | "lookup" | "done";
  currentKeywords: string[];
  roundSummaries: RoundSummary[];
};

export type TaskReport = {
  totalCandidates: number;
  admitted: number;
  discarded: number;
  lookupCalls: number;
  startedAt: string;
  finishedAt: string | null;
};

export function emptyProgress(config: LeadHuntTaskConfig): TaskProgress {
  return { currentRound: 0, totalRounds: config.maxRounds, phase: "keywords", currentKeywords: [], roundSummaries: [] };
}

export function emptyReport(startedAt: string): TaskReport {
  return { totalCandidates: 0, admitted: 0, discarded: 0, lookupCalls: 0, startedAt, finishedAt: null };
}
