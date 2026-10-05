import type { Prisma } from "@prisma/client";

/**
 * Agent 独立账号的每日提问额度（默认 50 问/天，可在 Agent 管理·账号管理中按账号调整）。
 * 按北京时间自然日计数；CRM 员工身份不适用（沿用每分钟限流）。
 *
 * 计数时机：请求通过校验即 +1（含最终回答失败的消息），防止刷额度；
 * 使用带 questionCount < quota 条件的原子更新，并发请求不会突破每日上限。
 */

export function beijingDateKey(now = new Date()): string {
  // 服务器可能是 UTC：北京时间 = UTC+8，取移位后的 YYYY-MM-DD
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function parseDateKeyToDate(key: string): Date {
  // Prisma @db.Date 接受 "YYYY-MM-DD" 字符串形式的 Date 对象构造
  return new Date(`${key}T00:00:00.000Z`);
}

export type DailyQuotaResult = {
  allowed: boolean;
  used: number;
  quota: number;
};

export async function consumeAgentDailyQuota(
  db: Pick<Prisma.TransactionClient, "agentUsageDaily">,
  agentAccountId: string,
  quota: number,
  now = new Date(),
): Promise<DailyQuotaResult> {
  const usageDate = parseDateKeyToDate(beijingDateKey(now));
  const key = { agentAccountId_usageDate: { agentAccountId, usageDate } };

  async function currentUsage() {
    const row = await db.agentUsageDaily.findUnique({
      where: key,
      select: { questionCount: true },
    });
    return row?.questionCount ?? 0;
  }

  async function incrementExisting() {
    return await db.agentUsageDaily.updateMany({
      where: { agentAccountId, usageDate, questionCount: { lt: quota } },
      data: { questionCount: { increment: 1 } },
    });
  }

  const incremented = await incrementExisting();
  if (incremented.count === 1) {
    return { allowed: true, used: await currentUsage(), quota };
  }

  const used = await currentUsage();
  if (used > 0) return { allowed: false, used, quota };

  try {
    await db.agentUsageDaily.create({ data: { agentAccountId, usageDate, questionCount: 1 } });
    return { allowed: true, used: 1, quota };
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
  }

  // 同日首问并发时，另一请求已经创建了行；重新走原子额度扣减。
  const racedIncrement = await incrementExisting();
  const racedUsed = await currentUsage();
  return racedIncrement.count === 1
    ? { allowed: true, used: racedUsed, quota }
    : { allowed: false, used: racedUsed, quota };
}
