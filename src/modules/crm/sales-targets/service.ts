import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { crmDashboardScope } from "@/modules/crm/dashboard/permissions";
import { DomainError } from "@/modules/shared/domain-error";
import { assertCanManageSalesTarget, assertCanReadSalesTarget } from "./permissions";

export type SalesTargetPeriodType = "MONTH" | "YEAR";
export type SalesTargetMetricType = "CONTRACT_AMOUNT" | "PAID_AMOUNT";

export type SalesTargetPeriodRange = {
  periodType: SalesTargetPeriodType;
  periodYear: number;
  periodIndex: number;
  start: Date;
  end: Date;
  label: string;
};

const MIN_YEAR = 2020;
const MAX_YEAR = 2100;
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;

export type SaveSalesTargetInput = {
  periodType: SalesTargetPeriodType;
  periodYear: number;
  periodIndex: number;
  metric: SalesTargetMetricType;
  amount: string;
  salesUserId: string | null;
  note: string | null;
};

export function parseTargetAmount(value: unknown): Prisma.Decimal {
  const normalized = typeof value === "number" || typeof value === "string"
    ? String(value).trim()
    : "";
  if (!MONEY_PATTERN.test(normalized)) {
    throw new DomainError("目标金额必须是最多两位小数且不超过 999999999999.99 的数字", 400);
  }

  const amount = new Prisma.Decimal(normalized);
  if (!amount.isFinite() || !amount.gt(0)) {
    throw new DomainError("目标金额必须大于 0", 400);
  }
  return amount;
}

export function calculateSalesTargetProgress(actualValue: unknown, targetValue: unknown) {
  const actual = new Prisma.Decimal(String(actualValue ?? 0));
  const target = new Prisma.Decimal(String(targetValue ?? 0));
  if (!actual.isFinite() || !target.isFinite() || target.lte(0)) {
    throw new DomainError("销售目标金额无效", 400);
  }

  const completionRate = actual.div(target).mul(100).toDecimalPlaces(1).toNumber();
  const exceeded = actual.gt(target);
  return {
    actualAmount: actual.toFixed(2),
    targetAmount: target.toFixed(2),
    completionRate,
    visualRate: Math.max(0, Math.min(100, completionRate)),
    remainingAmount: Prisma.Decimal.max(target.sub(actual), 0).toFixed(2),
    exceededAmount: Prisma.Decimal.max(actual.sub(target), 0).toFixed(2),
    exceeded,
  };
}

export function parseSalesTargetMetric(value: unknown): SalesTargetMetricType {
  const metric = String(value || "CONTRACT_AMOUNT").toUpperCase();
  if (metric !== "CONTRACT_AMOUNT" && metric !== "PAID_AMOUNT") {
    throw new DomainError("指标仅支持合同金额或回款金额", 400);
  }
  return metric;
}

export function parseSalesTargetPeriod(
  searchParams: URLSearchParams,
  now = new Date(),
): SalesTargetPeriodRange {
  const periodType = (searchParams.get("periodType") || "MONTH").toUpperCase();
  if (periodType !== "MONTH" && periodType !== "YEAR") {
    throw new DomainError("周期类型仅支持 MONTH 或 YEAR", 400);
  }

  const rawYear = searchParams.get("year");
  const periodYear = rawYear === null ? now.getFullYear() : Number(rawYear);
  if (!Number.isInteger(periodYear) || periodYear < MIN_YEAR || periodYear > MAX_YEAR) {
    throw new DomainError(`年份必须在 ${MIN_YEAR} 到 ${MAX_YEAR} 之间`, 400);
  }

  if (periodType === "YEAR") {
    return {
      periodType,
      periodYear,
      periodIndex: 0,
      start: new Date(periodYear, 0, 1),
      end: new Date(periodYear + 1, 0, 1),
      label: `${periodYear}年`,
    };
  }

  const rawMonth = searchParams.get("month");
  const periodIndex = rawMonth === null ? now.getMonth() + 1 : Number(rawMonth);
  if (!Number.isInteger(periodIndex) || periodIndex < 1 || periodIndex > 12) {
    throw new DomainError("月份必须在 1 到 12 之间", 400);
  }

  return {
    periodType,
    periodYear,
    periodIndex,
    start: new Date(periodYear, periodIndex - 1, 1),
    end: new Date(periodYear, periodIndex, 1),
    label: `${periodYear}年${periodIndex}月`,
  };
}

export function parseSalesTargetInput(value: unknown): SaveSalesTargetInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("销售目标参数无效", 400);
  }
  const body = value as Record<string, unknown>;
  const periodType = String(body.periodType || "").toUpperCase();
  if (periodType !== "MONTH" && periodType !== "YEAR") {
    throw new DomainError("周期类型仅支持 MONTH 或 YEAR", 400);
  }
  const periodYear = Number(body.periodYear);
  if (!Number.isInteger(periodYear) || periodYear < MIN_YEAR || periodYear > MAX_YEAR) {
    throw new DomainError(`年份必须在 ${MIN_YEAR} 到 ${MAX_YEAR} 之间`, 400);
  }
  const periodIndex = body.periodIndex === undefined || body.periodIndex === null
    ? periodType === "YEAR" ? 0 : Number.NaN
    : Number(body.periodIndex);
  if (periodType === "MONTH" && (!Number.isInteger(periodIndex) || periodIndex < 1 || periodIndex > 12)) {
    throw new DomainError("月度目标的月份必须在 1 到 12 之间", 400);
  }
  if (periodType === "YEAR" && periodIndex !== 0) {
    throw new DomainError("年度目标的 periodIndex 必须为 0", 400);
  }

  const salesUserId = typeof body.salesUserId === "string" && body.salesUserId.trim()
    ? body.salesUserId.trim()
    : null;
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
  return {
    periodType,
    periodYear,
    periodIndex,
    metric: parseSalesTargetMetric(body.metric),
    amount: parseTargetAmount(body.amount).toFixed(2),
    salesUserId,
    note,
  };
}

export async function getActualAmount(
  user: SessionUser,
  period: SalesTargetPeriodRange,
  metric: SalesTargetMetricType,
  salesUserId: string | null,
): Promise<Prisma.Decimal> {
  assertCanReadSalesTarget(user);
  if (salesUserId === null && user.role !== "SUPER_ADMIN") {
    throw new DomainError("无权限读取全公司目标", 403);
  }

  const { scope, selectedSalesUserId } = crmDashboardScope(user, {
    salesUserId: salesUserId || "",
  });
  // 全公司目标仅 SUPER_ADMIN 可见；个人目标仍严格沿用 Dashboard 的本人范围。
  const targetScope = salesUserId ? scope : {};
  const contractWhere: Prisma.ContractWhereInput = {
    deletedAt: null,
    customer: { deletedAt: null, ...targetScope },
    createdAt: { gte: period.start, lt: period.end },
  };
  if (salesUserId) {
    if (!selectedSalesUserId) throw new DomainError("无权限读取该销售员目标", 403);
    contractWhere.salesUserId = selectedSalesUserId;
  }

  const totals = await prisma.contract.aggregate({
    where: contractWhere,
    _sum: { amount: true, paidAmount: true },
  });
  return new Prisma.Decimal(
    String(metric === "PAID_AMOUNT" ? totals._sum.paidAmount || 0 : totals._sum.amount || 0),
  );
}

export async function listSalesTargets(
  user: SessionUser,
  period: SalesTargetPeriodRange,
  metric?: SalesTargetMetricType,
) {
  assertCanReadSalesTarget(user);
  const isAdmin = user.role === "SUPER_ADMIN";
  const rows = await prisma.salesTarget.findMany({
    where: {
      periodType: period.periodType,
      periodYear: period.periodYear,
      periodIndex: period.periodIndex,
      ...(metric ? { metric } : {}),
      ...(isAdmin ? {} : { salesUserId: user.id }),
    },
    orderBy: { updatedAt: "desc" },
  });
  const orderedRows = isAdmin ? rows : rows.filter((row) => row.salesUserId === user.id);

  const targets = await Promise.all(orderedRows.map(async (row) => {
    const actual = await getActualAmount(user, period, row.metric, row.salesUserId);
    return { ...row, amount: row.amount.toFixed(2), ...calculateSalesTargetProgress(actual, row.amount) };
  }));

  return {
    period: {
      type: period.periodType,
      year: period.periodYear,
      index: period.periodIndex,
      label: period.label,
      start: period.start,
      end: period.end,
    },
    targets,
  };
}

function isRetryableTransactionError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code);
}

export async function saveSalesTarget(user: SessionUser, rawInput: unknown) {
  assertCanManageSalesTarget(user);
  const input = parseSalesTargetInput(rawInput);
  if (input.salesUserId) {
    const targetUser = await prisma.user.findFirst({
      where: { id: input.salesUserId, isActive: true, role: { in: ["SALES", "FOREIGN_TRADE"] } },
      select: { id: true },
    });
    if (!targetUser) throw new DomainError("指定销售员不存在或不可用", 400);
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const scopeWhere = {
          periodType: input.periodType,
          periodYear: input.periodYear,
          periodIndex: input.periodIndex,
          metric: input.metric,
          salesUserId: input.salesUserId,
        };
        const existingRows = await tx.salesTarget.findMany({
          where: scopeWhere,
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        });
        const primary = existingRows[0];
        const row = primary
          ? await tx.salesTarget.update({
              where: { id: primary.id },
              data: { amount: input.amount, note: input.note, updatedById: user.id },
            })
          : await tx.salesTarget.create({
              data: {
                ...scopeWhere,
                amount: input.amount,
                note: input.note,
                createdById: user.id,
                updatedById: user.id,
              },
            });

        const duplicateIds = existingRows.slice(1).map((item) => item.id);
        if (duplicateIds.length) {
          await tx.salesTarget.deleteMany({ where: { id: { in: duplicateIds } } });
        }
        await writeOperationLog(tx, {
          userId: user.id,
          action: "UPDATE_SALES_TARGET",
          entityType: "SalesTarget",
          entityId: row.id,
          beforeData: primary || null,
          afterData: { ...row, removedDuplicateIds: duplicateIds },
        });
        return row;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (attempt < 2 && isRetryableTransactionError(error)) continue;
      throw error;
    }
  }
  throw new DomainError("销售目标保存失败，请重试", 503);
}
