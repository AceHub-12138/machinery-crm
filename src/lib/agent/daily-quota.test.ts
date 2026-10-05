import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { beijingDateKey, consumeAgentDailyQuota } from "@/lib/agent/daily-quota";

/** 内存版 agentUsageDaily mock，模拟 Prisma 行为 */
function makeDb(initial: Array<{ agentAccountId: string; usageDate: Date; questionCount: number }> = []) {
  const rows = initial.map((row) => ({ ...row }));
  const keyOf = (agentAccountId: string, usageDate: Date) => `${agentAccountId}|${usageDate.toISOString().slice(0, 10)}`;
  const agentUsageDaily = {
      async findUnique({ where }: { where: { agentAccountId_usageDate: { agentAccountId: string; usageDate: Date } } }) {
        const { agentAccountId, usageDate } = where.agentAccountId_usageDate;
        return rows.find((row) => keyOf(row.agentAccountId, row.usageDate) === keyOf(agentAccountId, usageDate)) ?? null;
      },
      async update({ where, data }: { where: { agentAccountId_usageDate: { agentAccountId: string; usageDate: Date } }; data: { questionCount: { increment: number } } }) {
        const { agentAccountId, usageDate } = where.agentAccountId_usageDate;
        const row = rows.find((item) => keyOf(item.agentAccountId, item.usageDate) === keyOf(agentAccountId, usageDate));
        if (!row) throw new Error("not found");
        row.questionCount += data.questionCount.increment;
        return row;
      },
      async create({ data }: { data: { agentAccountId: string; usageDate: Date; questionCount: number } }) {
        if (rows.some((row) => keyOf(row.agentAccountId, row.usageDate) === keyOf(data.agentAccountId, data.usageDate))) {
          throw Object.assign(new Error("unique constraint"), { code: "P2002" });
        }
        const row = { ...data };
        rows.push(row);
        return row;
      },
      async updateMany({ where, data }: {
        where: { agentAccountId: string; usageDate: Date; questionCount: { lt: number } };
        data: { questionCount: { increment: number } };
      }) {
        const row = rows.find((item) =>
          keyOf(item.agentAccountId, item.usageDate) === keyOf(where.agentAccountId, where.usageDate)
          && item.questionCount < where.questionCount.lt
        );
        if (!row) return { count: 0 };
        row.questionCount += data.questionCount.increment;
        return { count: 1 };
      },
    };
  const client = { agentUsageDaily } as unknown as Pick<Prisma.TransactionClient, "agentUsageDaily">;
  return { rows, agentUsageDaily, client };
}

describe("beijingDateKey", () => {
  it("UTC 16:00 之后（北京时间次日）归入新的一天", () => {
    // 2026-09-04T17:00:00Z = 北京时间 2026-09-05 01:00
    expect(beijingDateKey(new Date("2026-09-04T17:00:00Z"))).toBe("2026-09-05");
    // 2026-09-04T15:59:00Z = 北京时间 2026-09-04 23:59
    expect(beijingDateKey(new Date("2026-09-04T15:59:00Z"))).toBe("2026-09-04");
  });
});

describe("consumeAgentDailyQuota", () => {
  it("额度内放行并累加计数，超过额度拒绝", async () => {
    const db = makeDb();
    const fixed = new Date("2026-09-04T06:00:00Z");
    expect(await consumeAgentDailyQuota(db.client, "acc-1", 2, fixed)).toMatchObject({ allowed: true, used: 1, quota: 2 });
    expect(await consumeAgentDailyQuota(db.client, "acc-1", 2, fixed)).toMatchObject({ allowed: true, used: 2, quota: 2 });
    expect(await consumeAgentDailyQuota(db.client, "acc-1", 2, fixed)).toMatchObject({ allowed: false, used: 2, quota: 2 });
  });

  it("不同账号与不同日期各自独立计数", async () => {
    const db = makeDb();
    const day1 = new Date("2026-09-04T06:00:00Z");
    const day2 = new Date("2026-09-04T17:00:00Z"); // 北京时间已是 9-5
    expect((await consumeAgentDailyQuota(db.client, "acc-1", 50, day1)).allowed).toBe(true);
    expect((await consumeAgentDailyQuota(db.client, "acc-2", 50, day1)).allowed).toBe(true);
    expect((await consumeAgentDailyQuota(db.client, "acc-1", 50, day2)).allowed).toBe(true);
    expect(db.rows).toHaveLength(3);
  });

  it("首问 create 冲突时回退为增量更新（并发竞态兜底）", async () => {
    const db = makeDb([{
      agentAccountId: "acc-x",
      usageDate: new Date("2026-09-04T00:00:00.000Z"),
      questionCount: 0,
    }]);
    const fixed = new Date("2026-09-04T06:00:00Z");
    // 模拟两个首问并发：本请求先读不到行，另一个请求已插入，随后本请求 create 命中唯一键冲突。
    const findUnique = db.agentUsageDaily.findUnique.bind(db.agentUsageDaily);
    const updateMany = db.agentUsageDaily.updateMany.bind(db.agentUsageDaily);
    let firstRead = true;
    let firstUpdate = true;
    db.agentUsageDaily.updateMany = async (args) => {
      if (firstUpdate) {
        firstUpdate = false;
        return { count: 0 };
      }
      return updateMany(args);
    };
    db.agentUsageDaily.findUnique = async (args) => {
      if (firstRead) {
        firstRead = false;
        return null;
      }
      return findUnique(args);
    };
    db.agentUsageDaily.create = async () => {
      throw Object.assign(new Error("unique constraint"), { code: "P2002" });
    };
    const result = await consumeAgentDailyQuota(db.client, "acc-x", 50, fixed);
    expect(result).toMatchObject({ allowed: true, used: 1, quota: 50 });
    expect(db.rows).toEqual([
      expect.objectContaining({ agentAccountId: "acc-x", questionCount: 1 }),
    ]);
  });

  it("只剩一次额度时，并发提问只放行一次", async () => {
    const db = makeDb();
    const fixed = new Date("2026-09-04T06:00:00Z");

    const results = await Promise.all([
      consumeAgentDailyQuota(db.client, "acc-1", 1, fixed),
      consumeAgentDailyQuota(db.client, "acc-1", 1, fixed),
    ]);

    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(results.filter((result) => !result.allowed)).toHaveLength(1);
    expect(db.rows).toEqual([
      expect.objectContaining({ agentAccountId: "acc-1", questionCount: 1 }),
    ]);
  });
});
