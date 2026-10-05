import type { Prisma } from "@prisma/client";
import { z } from "zod/v4";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/permissions";
import { leadVisibilityWhere } from "@/modules/crm/leads/access";
import { DomainError } from "@/modules/shared/domain-error";

const leadListSelect = {
  id: true,
  companyName: true,
  contactName: true,
  phone: true,
  email: true,
  aiScore: true,
  reviewStatus: true,
  searchKeyword: true,
  source: true,
  assignedUserId: true,
  createdAt: true,
  feedbackVersion: true,
} satisfies Prisma.LeadSelect;

const userSummarySelect = {
  id: true,
  name: true,
  email: true,
  role: true,
} satisfies Prisma.UserSelect;

const leadDetailSelect = {
  id: true,
  companyName: true,
  contactName: true,
  phone: true,
  email: true,
  source: true,
  sourceUrl: true,
  searchKeyword: true,
  aiScore: true,
  profile: true,
  sourceModelVersion: true,
  extractorVersion: true,
  reviewStatus: true,
  assignedUserId: true,
  reviewedByUserId: true,
  reviewedAt: true,
  feedbackVersion: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.LeadSelect;

const feedbackEventSelect = {
  id: true,
  leadId: true,
  reviewStatus: true,
  reviewReasonCode: true,
  comment: true,
  reviewedByUserId: true,
  reviewedAt: true,
} satisfies Prisma.LeadFeedbackEventSelect;

const reviewStatuses = new Set(["PENDING", "HIGH_INTENT", "MID_INTENT", "LOW_INTENT", "INVALID"]);

function optionalScore(searchParams: URLSearchParams, name: string) {
  const raw = searchParams.get(name)?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new DomainError(`${name} 必须是 0 到 100 的整数`);
  }
  return value;
}

function optionalDate(searchParams: URLSearchParams, name: string) {
  const raw = searchParams.get(name)?.trim();
  if (!raw) return undefined;
  if (!z.string().date().safeParse(raw).success) throw new DomainError(`${name} 日期格式不合法`);
  const value = new Date(`${raw}T00:00:00+08:00`);
  if (Number.isNaN(value.getTime())) throw new DomainError(`${name} 日期格式不合法`);
  return value;
}

export async function listHumanLeads(user: SessionUser, searchParams: URLSearchParams) {
  const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(searchParams.get("pageSize") || "20", 10) || 20));
  const where: Prisma.LeadWhereInput = leadVisibilityWhere(user);
  const reviewStatus = searchParams.get("reviewStatus")?.trim();
  if (reviewStatus) {
    if (!reviewStatuses.has(reviewStatus)) throw new DomainError("reviewStatus 不合法");
    where.reviewStatus = reviewStatus as Prisma.EnumLeadReviewStatusFilter;
  } else if (searchParams.get("excludeInvalid") === "1") {
    where.reviewStatus = { not: "INVALID" };
  }
  const aiScoreMin = optionalScore(searchParams, "aiScoreMin");
  const aiScoreMax = optionalScore(searchParams, "aiScoreMax");
  if (aiScoreMin !== undefined && aiScoreMax !== undefined && aiScoreMin > aiScoreMax) {
    throw new DomainError("aiScoreMin 不能大于 aiScoreMax");
  }
  if (aiScoreMin !== undefined || aiScoreMax !== undefined) {
    where.aiScore = { gte: aiScoreMin, lte: aiScoreMax };
  }
  const searchKeyword = searchParams.get("searchKeyword")?.trim();
  if (searchKeyword) where.searchKeyword = { contains: searchKeyword };
  const assignedUserId = searchParams.get("assignedUserId")?.trim();
  if (assignedUserId && user.role === "SUPER_ADMIN") where.assignedUserId = assignedUserId;
  const createdFrom = optionalDate(searchParams, "createdFrom");
  const createdTo = optionalDate(searchParams, "createdTo");
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw new DomainError("createdFrom 不能晚于 createdTo");
  }
  if (createdFrom || createdTo) {
    where.createdAt = {
      gte: createdFrom,
      lt: createdTo ? new Date(createdTo.getTime() + 86_400_000) : undefined,
    };
  }
  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      select: leadListSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.lead.count({ where }),
  ]);
  const assignedUserIds = [...new Set(leads.map((lead) => lead.assignedUserId).filter((id): id is string => Boolean(id)))];
  const assignedUsers = assignedUserIds.length
    ? await prisma.user.findMany({ where: { id: { in: assignedUserIds } }, select: userSummarySelect })
    : [];
  const userById = new Map(assignedUsers.map((assignedUser) => [assignedUser.id, assignedUser]));

  return {
    items: leads.map((lead) => ({
      ...lead,
      assignedUser: lead.assignedUserId ? userById.get(lead.assignedUserId) ?? null : null,
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getHumanLeadDetail(user: SessionUser, leadId: string) {
  const visibilityWhere = leadVisibilityWhere(user);
  const detail = await prisma.$transaction(async (tx) => {
    const lockedLead = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM leads
      WHERE id = ${leadId}
      FOR UPDATE
    `;
    if (!lockedLead.length) throw new DomainError("Lead 不存在或无权访问", 404);
    const lead = await tx.lead.findFirst({
      where: { id: leadId, ...visibilityWhere },
      select: leadDetailSelect,
    });
    if (!lead) throw new DomainError("Lead 不存在或无权访问", 404);
    const feedbackEvents = await tx.leadFeedbackEvent.findMany({
      where: { leadId },
      select: feedbackEventSelect,
      orderBy: [{ reviewedAt: "desc" }, { id: "desc" }],
    });
    return { lead, feedbackEvents };
  });
  const { lead, feedbackEvents } = detail;
  const userIds = [...new Set([
    lead.assignedUserId,
    lead.reviewedByUserId,
    ...feedbackEvents.map((event) => event.reviewedByUserId),
  ].filter((id): id is string => Boolean(id)))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: userSummarySelect })
    : [];
  const userById = new Map(users.map((entry) => [entry.id, entry]));

  return {
    ...lead,
    assignedUser: lead.assignedUserId ? userById.get(lead.assignedUserId) ?? null : null,
    reviewedByUser: lead.reviewedByUserId ? userById.get(lead.reviewedByUserId) ?? null : null,
    feedbackEvents: feedbackEvents.map((event) => ({
      ...event,
      reviewedByUser: event.reviewedByUserId ? userById.get(event.reviewedByUserId) ?? null : null,
    })),
  };
}
