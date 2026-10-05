import { z } from "zod/v4";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/permissions";
import { assertLeadAccess, leadVisibilityWhere } from "@/modules/crm/leads/access";
import {
  HUMAN_LEAD_REVIEW_STATUSES,
  LEAD_FEEDBACK_REASON_CODES,
  leadFeedbackReasonsForStatus,
  requiresLeadFeedbackComment,
} from "@/modules/crm/leads/feedback-contract";
import { DomainError } from "@/modules/shared/domain-error";

type LeadConflictState = {
  assignedUserId: string | null;
  feedbackVersion: number;
};

const leadFeedbackInputSchema = z.object({
  reviewStatus: z.enum(HUMAN_LEAD_REVIEW_STATUSES),
  reviewReasonCode: z.enum(LEAD_FEEDBACK_REASON_CODES),
  comment: z.string().trim().max(2_000).optional(),
  expectedFeedbackVersion: z.number().int().nonnegative(),
}).strict().superRefine((value, context) => {
  if (!leadFeedbackReasonsForStatus(value.reviewStatus).includes(value.reviewReasonCode)) {
    context.addIssue({
      code: "custom",
      path: ["reviewReasonCode"],
      message: "原因码与反馈状态不匹配",
    });
  }
  if (requiresLeadFeedbackComment(value.reviewReasonCode) && !value.comment) {
    context.addIssue({
      code: "custom",
      path: ["comment"],
      message: "OTHER 原因必须填写备注",
    });
  }
});

type LeadFeedbackInput = z.infer<typeof leadFeedbackInputSchema>;

const leadInvalidBatchInputSchema = z.object({
  items: z.array(z.object({
    leadId: z.string().trim().min(1).max(191),
    expectedFeedbackVersion: z.number().int().nonnegative(),
  }).strict()).min(1).max(100),
  reviewReasonCode: z.enum(LEAD_FEEDBACK_REASON_CODES),
  comment: z.string().trim().max(2_000).optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.items.map((item) => item.leadId)).size !== value.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "Lead 不能重复选择" });
  }
  if (!leadFeedbackReasonsForStatus("INVALID").includes(value.reviewReasonCode)) {
    context.addIssue({ code: "custom", path: ["reviewReasonCode"], message: "原因码不适用于无效线索" });
  }
  if (requiresLeadFeedbackComment(value.reviewReasonCode) && !value.comment) {
    context.addIssue({ code: "custom", path: ["comment"], message: "OTHER 原因必须填写备注" });
  }
});

async function applyLeadFeedback(
  tx: Prisma.TransactionClient,
  user: SessionUser,
  leadId: string,
  feedback: LeadFeedbackInput,
  reviewedAt: Date,
) {
  const lead = await tx.lead.findUnique({
    where: { id: leadId },
    select: { id: true, assignedUserId: true, feedbackVersion: true },
  });
  if (!lead) throw new DomainError("Lead 不存在", 404);
  assertLeadAccess(user, lead, "只能反馈明确指派给本人的 Lead");

  const updated = await tx.lead.updateMany({
    where: {
      id: leadId,
      feedbackVersion: feedback.expectedFeedbackVersion,
      ...(user.role === "SUPER_ADMIN" ? {} : { assignedUserId: user.id }),
    },
    data: {
      reviewStatus: feedback.reviewStatus,
      reviewedByUserId: user.id,
      reviewedAt,
      feedbackVersion: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    const [current] = await tx.$queryRaw<LeadConflictState[]>`
      SELECT assignedUserId, feedbackVersion
      FROM leads
      WHERE id = ${leadId}
      FOR UPDATE
    `;
    if (!current) throw new DomainError("Lead 不存在", 404);
    if (user.role !== "SUPER_ADMIN" && current.assignedUserId !== user.id) {
      throw new DomainError("只能反馈明确指派给本人的 Lead", 403);
    }
    throw new DomainError("反馈版本已变化，请刷新后重试", 409);
  }

  const event = await tx.leadFeedbackEvent.create({
    data: {
      leadId,
      reviewStatus: feedback.reviewStatus,
      reviewReasonCode: feedback.reviewReasonCode,
      comment: feedback.comment || null,
      reviewedByUserId: user.id,
      reviewedAt,
    },
    select: { id: true },
  });

  return {
    id: leadId,
    reviewStatus: feedback.reviewStatus,
    reviewedByUserId: user.id,
    reviewedAt,
    feedbackVersion: feedback.expectedFeedbackVersion + 1,
    feedbackEventId: event.id,
  };
}

function mapFeedbackTransactionError(error: unknown): never {
  if (error instanceof DomainError) throw error;
  if ((error as { code?: unknown })?.code === "P2034") {
    throw new DomainError("反馈并发冲突，请刷新后重试", 409);
  }
  throw error;
}

export async function submitLeadFeedback(
  user: SessionUser,
  leadId: string,
  input: unknown,
  options: { now?: () => Date } = {},
) {
  const parsed = leadFeedbackInputSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("反馈参数不合法");
  const feedback = parsed.data;
  const reviewedAt = (options.now ?? (() => new Date()))();

  leadVisibilityWhere(user);

  try {
    return await prisma.$transaction((tx) => applyLeadFeedback(tx, user, leadId, feedback, reviewedAt));
  } catch (error) {
    return mapFeedbackTransactionError(error);
  }
}

export async function submitLeadInvalidFeedbackBatch(
  user: SessionUser,
  input: unknown,
  options: { now?: () => Date } = {},
) {
  const parsed = leadInvalidBatchInputSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("批量无效参数不合法");
  leadVisibilityWhere(user);
  const reviewedAt = (options.now ?? (() => new Date()))();

  try {
    return await prisma.$transaction(async (tx) => {
      const items = [];
      for (const item of parsed.data.items) {
        items.push(await applyLeadFeedback(tx, user, item.leadId, {
          reviewStatus: "INVALID",
          reviewReasonCode: parsed.data.reviewReasonCode,
          comment: parsed.data.comment,
          expectedFeedbackVersion: item.expectedFeedbackVersion,
        }, reviewedAt));
      }
      return { items };
    });
  } catch (error) {
    return mapFeedbackTransactionError(error);
  }
}
