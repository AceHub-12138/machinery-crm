import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createLeadHunterEngine } from "@/lib/lead-hunter/engine";
import { companyDedupKey } from "@/lib/lead-hunter/dedup";
import type { SearchClient, WebSearchResult } from "@/lib/lead-hunter/qianfan";
import type { TianyanchaClient } from "@/lib/lead-hunter/tianyancha";
import type { LeadHuntTaskConfig } from "@/lib/lead-hunter/types";

/** 引擎测试：全部依赖注入 fake（不连库、不出网），覆盖关键词迭代/评分过滤/去重/反查上限/中断兜底。 */

function searchResult(overrides: Partial<WebSearchResult>): WebSearchResult {
  return { title: "标题", url: "https://example.com/a", content: "正文内容", snippet: "", date: "", website: "example.com", ...overrides };
}

const baseConfig: LeadHuntTaskConfig = {
  goal: "找浙江做齿轮键槽加工的厂家",
  maxRounds: 1,
  pagesPerRound: 1,
  keywordIterations: 0,
  passingScore: 70,
  dailyLookupLimit: 5,
  lookupMode: "MANUAL",
};

type TaskRow = {
  id: string;
  status: string;
  config: LeadHuntTaskConfig;
  progress: unknown;
  report: unknown;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function createFakeDb() {
  const tasks = new Map<string, TaskRow>();
  const candidates: Array<Record<string, unknown> & { id: string }> = [];
  const leads = new Map<string, Record<string, unknown> & { id: string }>();
  const operationLogs: unknown[] = [];
  let candidateSeq = 0;
  let leadSeq = 0;

  const prisma = {
    leadHuntTask: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => tasks.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<TaskRow> }) => {
        const task = tasks.get(where.id)!;
        Object.assign(task, data);
        return task;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status?: string }; data: Partial<TaskRow> }) => {
        const task = tasks.get(where.id);
        if (!task || (where.status && task.status !== where.status)) return { count: 0 };
        Object.assign(task, data);
        return { count: 1 };
      }),
    },
    leadHuntCandidate: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        candidateSeq += 1;
        const row = { id: `cand-${candidateSeq}`, leadId: null, ...data };
        candidates.push(row);
        return row;
      }),
      findMany: vi.fn(async ({ where, orderBy }: { where: { taskId: string; status?: string }; orderBy?: Array<Record<string, string>> }) => {
        let rows = candidates.filter((row) => row.taskId === where.taskId);
        if (where.status) rows = rows.filter((row) => row.status === where.status);
        for (const rule of [...(orderBy ?? [])].reverse()) {
          const key = Object.keys(rule)[0];
          rows = [...rows].sort((left, right) => {
            const a = Number(left[key] ?? 0);
            const b = Number(right[key] ?? 0);
            return rule[key] === "desc" ? b - a : a - b;
          });
        }
        return rows;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = candidates.find((item) => item.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    lead: {
      findFirst: vi.fn(async ({ where }: { where: { OR: Array<{ dedupKey?: string; companyName?: { contains: string } }> } }) => {
        for (const lead of leads.values()) {
          for (const condition of where.OR) {
            if (condition.dedupKey && lead.dedupKey === condition.dedupKey) return lead;
            if (condition.companyName?.contains && String(lead.companyName).includes(condition.companyName.contains)) return lead;
          }
        }
        return null;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id?: string; idempotencyKey?: string } }) => {
        for (const lead of leads.values()) {
          if (where.id && lead.id === where.id) return lead;
          if (where.idempotencyKey && lead.idempotencyKey === where.idempotencyKey) return lead;
        }
        return null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        leadSeq += 1;
        const row = { id: `lead-${leadSeq}`, assignedUserId: null, ...data };
        leads.set(row.id, row);
        return row;
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };

  function addTask(id: string, config: LeadHuntTaskConfig, overrides?: Partial<TaskRow>) {
    const now = new Date();
    tasks.set(id, { id, status: "running", config, progress: null, report: null, error: null, createdAt: now, updatedAt: now, ...overrides });
  }

  return { prisma: prisma as unknown as PrismaClient, tasks, candidates, leads, operationLogs, addTask };
}

function createFakeTianyancha(results: Array<string | null>): { client: TianyanchaClient } {
  let calls = 0;
  const client: TianyanchaClient = {
    lookupCompany: vi.fn(async () => {
      const phone = results[calls] ?? null;
      calls += 1;
      return phone
        ? { found: true, phone, legalPerson: "陈某某", regAddress: "浙江省宁波市鄞州区", raw: { mock: true } }
        : { found: false, phone: null, legalPerson: null, regAddress: null, raw: { mock: true } };
    }),
    todayCallCount: () => calls,
  };
  return { client };
}

describe("lead-hunter engine", () => {
  it("多轮关键词迭代：第 2 轮规划输入带上第 1 轮关键词与达标反馈", async () => {
    const db = createFakeDb();
    db.addTask("t1", { ...baseConfig, maxRounds: 2, keywordIterations: 1 });
    const search: SearchClient = {
      searchWeb: vi.fn(async () => [searchResult({ url: "https://a.com/1", title: "宁波恒精", content: "齿轮加工 联系 13812345678" })]),
    };
    const llm = vi.fn()
      .mockResolvedValueOnce({ keywords: ["齿轮加工"] })
      .mockResolvedValueOnce({ isCompany: true, companyName: "宁波恒精传动科技有限公司", aiScore: 88, scoreReason: "行业匹配且有手机号", province: "浙江省", city: "宁波市", contactName: "王经理", phone: "13812345678", email: "" })
      .mockResolvedValueOnce({ keywords: ["插床 供应商"] });

    const engine = createLeadHunterEngine({ prisma: db.prisma, search, llm, tianyancha: createFakeTianyancha([]).client });
    await engine.runTask("t1");

    const task = db.tasks.get("t1")!;
    expect(task.status).toBe("done");
    expect(llm).toHaveBeenCalledTimes(3);
    expect(String(llm.mock.calls[2][0].user)).toContain("齿轮加工");
    expect(String(llm.mock.calls[2][0].user)).toContain("达标");
    expect((task.progress as { roundSummaries: unknown[] }).roundSummaries).toHaveLength(2);
    expect(db.candidates).toHaveLength(1);
    expect(db.candidates[0].status).toBe("PENDING_CONFIRM");
  });

  it("评分过滤：达标有电话→待确认，达标无电话→待反查，低分→归档", async () => {
    const db = createFakeDb();
    db.addTask("t1", baseConfig);
    const search: SearchClient = {
      searchWeb: vi.fn(async () => [
        searchResult({ url: "https://a.com/1", title: "甲公司", content: "c1" }),
        searchResult({ url: "https://b.com/2", title: "乙公司", content: "c2" }),
        searchResult({ url: "https://c.com/3", title: "丙公司", content: "c3" }),
      ]),
    };
    const llm = vi.fn()
      .mockResolvedValueOnce({ keywords: ["k1"] })
      .mockResolvedValueOnce({ isCompany: true, companyName: "甲公司", aiScore: 85, scoreReason: "匹配", province: "浙江省", city: "", contactName: "", phone: "13812345678", email: "" })
      .mockResolvedValueOnce({ isCompany: true, companyName: "乙公司", aiScore: 80, scoreReason: "匹配", province: "", city: "", contactName: "", phone: "", email: "" })
      .mockResolvedValueOnce({ isCompany: true, companyName: "丙公司", aiScore: 60, scoreReason: "行业不匹配", province: "", city: "", contactName: "", phone: "", email: "" });

    const engine = createLeadHunterEngine({ prisma: db.prisma, search, llm, tianyancha: createFakeTianyancha([]).client });
    await engine.runTask("t1");

    expect(db.tasks.get("t1")!.status).toBe("done");
    expect(db.candidates.map((candidate) => candidate.status)).toEqual(["PENDING_CONFIRM", "NO_CONTACT", "DISCARDED"]);
    expect(db.candidates.map((candidate) => candidate.province)).toEqual(["浙江省", null, null]);
    expect((db.tasks.get("t1")!.report as { discarded: number }).discarded).toBe(1);
  });

  it("去重：搜索结果同公司只建一条；与线索池已有公司（dedupKey）重复的不建", async () => {
    const db = createFakeDb();
    db.addTask("t1", baseConfig);
    db.leads.set("lead-existing", {
      id: "lead-existing",
      companyName: "老客户机械有限公司",
      dedupKey: companyDedupKey("老客户机械有限公司"),
    });
    const search: SearchClient = {
      searchWeb: vi.fn(async () => [
        searchResult({ url: "https://a.com/1", title: "甲公司官网", content: "c1" }),
        searchResult({ url: "https://a.com/dup", title: "甲公司黄页", content: "c1 其他来源" }),
        searchResult({ url: "https://old.com/1", title: "老客户机械有限公司", content: "c3" }),
      ]),
    };
    const llm = vi.fn()
      .mockResolvedValueOnce({ keywords: ["k1"] })
      .mockResolvedValueOnce({ isCompany: true, companyName: "甲公司", aiScore: 90, scoreReason: "匹配", province: "", city: "", contactName: "", phone: "13812345678", email: "" })
      .mockResolvedValueOnce({ isCompany: true, companyName: "甲公司", aiScore: 90, scoreReason: "匹配", province: "", city: "", contactName: "", phone: "13812345678", email: "" })
      .mockResolvedValueOnce({ isCompany: true, companyName: "老客户机械有限公司", aiScore: 92, scoreReason: "匹配", province: "", city: "", contactName: "", phone: "", email: "" });

    const engine = createLeadHunterEngine({ prisma: db.prisma, search, llm, tianyancha: createFakeTianyancha([]).client });
    await engine.runTask("t1");

    expect(db.candidates).toHaveLength(1);
    expect(db.candidates[0].companyName).toBe("甲公司");
  });

  it("AUTO 反查受每日上限约束：上限 1 时只调用 1 次天眼查", async () => {
    const db = createFakeDb();
    db.addTask("t1", { ...baseConfig, lookupMode: "AUTO", dailyLookupLimit: 1 });
    const search: SearchClient = {
      searchWeb: vi.fn(async () => [
        searchResult({ url: "https://a.com/1", title: "甲公司", content: "c1" }),
        searchResult({ url: "https://b.com/2", title: "乙公司", content: "c2" }),
      ]),
    };
    const llm = vi.fn()
      .mockResolvedValueOnce({ keywords: ["k1"] })
      .mockResolvedValueOnce({ isCompany: true, companyName: "甲公司", aiScore: 90, scoreReason: "匹配", province: "浙江省", city: "", contactName: "", phone: "", email: "" })
      .mockResolvedValueOnce({ isCompany: true, companyName: "乙公司", aiScore: 85, scoreReason: "匹配", province: "", city: "", contactName: "", phone: "", email: "" });
    const tianyancha = createFakeTianyancha(["13957881234"]);

    const engine = createLeadHunterEngine({ prisma: db.prisma, search, llm, tianyancha: tianyancha.client });
    await engine.runTask("t1");

    expect(tianyancha.client.lookupCompany).toHaveBeenCalledTimes(1);
    expect(db.candidates.map((candidate) => candidate.status)).toEqual(["LOOKUP_FOUND", "NO_CONTACT"]);
    expect(db.candidates[0].phone).toBe("13957881234");
    expect((db.tasks.get("t1")!.report as { lookupCalls: number }).lookupCalls).toBe(1);
  });

  it("关键词规划首轮失败：任务 failed 并落错误信息", async () => {
    const db = createFakeDb();
    db.addTask("t1", baseConfig);
    const llm = vi.fn().mockRejectedValue(new Error("LLM 超时"));
    const engine = createLeadHunterEngine({
      prisma: db.prisma,
      search: { searchWeb: vi.fn(async () => []) },
      llm,
      tianyancha: createFakeTianyancha([]).client,
    });
    await engine.runTask("t1");

    const task = db.tasks.get("t1")!;
    expect(task.status).toBe("failed");
    expect(task.error).toContain("LLM 超时");
    expect(db.candidates).toHaveLength(0);
  });

  it("服务重启中断兜底：running 且心跳超时标 failed；正常任务不受影响", async () => {
    const db = createFakeDb();
    db.addTask("t-stale", baseConfig, { updatedAt: new Date(Date.now() - 10 * 60 * 1000) });
    db.addTask("t-fresh", baseConfig);
    db.tasks.get("t-fresh")!.status = "done";
    const engine = createLeadHunterEngine({ prisma: db.prisma, tianyancha: createFakeTianyancha([]).client });

    await engine.markInterruptedIfStale("t-stale");
    await engine.markInterruptedIfStale("t-fresh");

    expect(db.tasks.get("t-stale")!.status).toBe("failed");
    expect(db.tasks.get("t-stale")!.error).toContain("服务重启");
    expect(db.tasks.get("t-fresh")!.status).toBe("done");
  });
});
