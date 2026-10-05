import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { admitCandidates, reverseLookupCandidates } from "@/lib/lead-hunter/admit";
import type { SessionUser } from "@/lib/customer-permissions";
import type { TianyanchaClient } from "@/lib/lead-hunter/tianyancha";
import type { LeadHuntTaskConfig } from "@/lib/lead-hunter/types";

/** 入池分单测试：按省自动分配销售、幂等入池、人工反查的每日上限护栏。 */

function buildUser(): SessionUser {
  return {
    id: "admin-1",
    email: "admin@dachuan.local",
    name: "管理员",
    role: "SUPER_ADMIN",
    region: "其他",
    territories: [],
    viewScope: "ALL",
    isActive: true,
  } as SessionUser;
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

function createFakeDb(options?: { users?: Array<Record<string, unknown>> }) {
  const users = options?.users ?? [];
  const tasks = new Map<string, Record<string, unknown>>();
  const candidates: Array<Record<string, unknown> & { id: string; taskId: string }> = [];
  const leads = new Map<string, Record<string, unknown> & { id: string }>();
  const operationLogs: Array<Record<string, unknown>> = [];
  let leadSeq = 0;

  function leadUniquenessHit(data: Record<string, unknown>) {
    for (const lead of leads.values()) {
      if (data.idempotencyKey && lead.idempotencyKey === data.idempotencyKey) return lead;
      if (data.dedupKey && lead.dedupKey === data.dedupKey) return lead;
    }
    return null;
  }

  const prisma = {
    leadHuntTask: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => tasks.get(where.id) ?? null),
    },
    leadHuntCandidate: {
      findMany: vi.fn(async ({ where }: { where: { taskId: string; id?: { in: string[] }; status?: { in?: string[]; notIn?: string[] } | string } }) => {
        let rows = candidates.filter((row) => row.taskId === where.taskId);
        if (where.id?.in) rows = rows.filter((row) => where.id!.in.includes(row.id));
        const statusFilter = where.status;
        if (typeof statusFilter === "string") {
          rows = rows.filter((row) => row.status === statusFilter);
        } else if (statusFilter && typeof statusFilter === "object") {
          const inList = statusFilter.in;
          const notInList = statusFilter.notIn;
          if (inList) rows = rows.filter((row) => inList.includes(String(row.status)));
          if (notInList) rows = rows.filter((row) => !notInList.includes(String(row.status)));
        }
        return rows;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = candidates.find((item) => item.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    user: {
      findMany: vi.fn(async () => users),
    },
    lead: {
      findUnique: vi.fn(async ({ where }: { where: { idempotencyKey?: string } }) => {
        if (!where.idempotencyKey) return null;
        for (const lead of leads.values()) {
          if (lead.idempotencyKey === where.idempotencyKey) return lead;
        }
        return null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const conflict = leadUniquenessHit(data);
        if (conflict) {
          const error = new Error("Unique constraint failed") as Error & { code: string };
          error.code = "P2002";
          throw error;
        }
        leadSeq += 1;
        const row = { id: `lead-${leadSeq}`, assignedUserId: null, ...data };
        leads.set(row.id, row);
        return row;
      }),
    },
    operationLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        operationLogs.push(data);
        return data;
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };

  function addTask(id: string, config: LeadHuntTaskConfig) {
    tasks.set(id, { id, config, status: "done" });
  }

  function addCandidate(id: string, taskId: string, overrides?: Record<string, unknown>) {
    candidates.push({
      id,
      taskId,
      companyName: "宁波恒精传动科技有限公司",
      status: "PENDING_CONFIRM",
      phone: "13812345678",
      email: null,
      province: "浙江省",
      city: "宁波市",
      score: 88,
      scoreReason: "行业匹配",
      sourceUrl: "https://a.com/1",
      keywords: ["齿轮加工"],
      leadId: null,
      ...overrides,
    });
  }

  return { prisma: prisma as unknown as PrismaClient, tasks, candidates, leads, operationLogs, addTask, addCandidate };
}

function createFakeTianyancha(phone: string | null): { client: TianyanchaClient } {
  let calls = 0;
  const client: TianyanchaClient = {
    lookupCompany: vi.fn(async () => {
      calls += 1;
      return phone
        ? { found: true, phone, legalPerson: "陈某某", regAddress: "浙江省宁波市鄞州区", raw: { mock: true } }
        : { found: false, phone: null, legalPerson: null, regAddress: null, raw: { mock: true } };
    }),
    todayCallCount: () => calls,
  };
  return { client };
}

describe("admitCandidates 入池分单", () => {
  it("按 profile 省市自动分配给对应区域销售，并写操作日志", async () => {
    const user = buildUser();
    const db = createFakeDb({
      users: [
        { id: "sales-zj", role: "SALES", isActive: true, territories: [{ province: "浙江省", cities: [] }] },
        { id: "sales-sd", role: "SALES", isActive: true, territories: [{ province: "山东省", cities: [] }] },
      ],
    });
    db.addTask("t1", baseConfig);
    db.addCandidate("c1", "t1");

    const result = await admitCandidates(user, "t1", ["c1"], { prisma: db.prisma });

    expect(result.admitted).toBe(1);
    const lead = [...db.leads.values()][0];
    expect(lead.assignedUserId).toBe("sales-zj");
    expect(lead.sourceSystem).toBe("lead-hunter");
    expect(lead.idempotencyKey).toBe("lead-hunter-c1");
    expect(db.candidates[0].status).toBe("ADMITTED");
    expect(db.candidates[0].leadId).toBe(lead.id);
    expect(db.operationLogs).toHaveLength(1);
    expect(String(db.operationLogs[0].action)).toContain("AUTO_ASSIGN|old=-|new=sales-zj");
  });

  it("无匹配区域销售时保持未指派（不随机指派）", async () => {
    const db = createFakeDb({
      users: [{ id: "sales-sd", role: "SALES", isActive: true, territories: [{ province: "山东省", cities: [] }] }],
    });
    db.addTask("t1", baseConfig);
    db.addCandidate("c1", "t1");

    const result = await admitCandidates(buildUser(), "t1", ["c1"], { prisma: db.prisma });

    expect(result.admitted).toBe(1);
    const lead = [...db.leads.values()][0];
    expect(lead.assignedUserId).toBeNull();
    expect(String(db.operationLogs[0].action)).toContain("NO_MATCHING_ASSIGNEE");
  });

  it("重复入池走幂等：不重复建线索", async () => {
    const db = createFakeDb({ users: [] });
    db.addTask("t1", baseConfig);
    db.addCandidate("c1", "t1");
    const user = buildUser();

    await admitCandidates(user, "t1", ["c1"], { prisma: db.prisma });
    const result = await admitCandidates(user, "t1", ["c1"], { prisma: db.prisma });

    expect(db.leads.size).toBe(1);
    expect(result.results[0].replay).toBe(true);
  });

  it("低分归档候选不允许入池", async () => {
    const db = createFakeDb({ users: [] });
    db.addTask("t1", baseConfig);
    db.addCandidate("c1", "t1", { status: "DISCARDED" });

    await expect(admitCandidates(buildUser(), "t1", ["c1"], { prisma: db.prisma })).rejects.toThrow("状态不允许入池");
  });
});

describe("reverseLookupCandidates 人工反查", () => {
  it("勾选数超过当日剩余额度时拒绝（计费护栏）", async () => {
    const db = createFakeDb({ users: [] });
    db.addTask("t1", { ...baseConfig, dailyLookupLimit: 1 });
    db.addCandidate("c1", "t1", { status: "NO_CONTACT", phone: null });
    db.addCandidate("c2", "t1", { status: "NO_CONTACT", phone: null });
    const tianyancha = createFakeTianyancha("13957881234");

    await expect(
      reverseLookupCandidates(buildUser(), "t1", ["c1", "c2"], { prisma: db.prisma, tianyancha: tianyancha.client }),
    ).rejects.toThrow("剩余额度");
    expect(tianyancha.client.lookupCompany).not.toHaveBeenCalled();
  });

  it("反查成功回填电话，失败标反查无果；返回剩余额度", async () => {
    const db = createFakeDb({ users: [] });
    db.addTask("t1", baseConfig);
    db.addCandidate("c1", "t1", { status: "NO_CONTACT", phone: null, companyName: "宁波恒精传动科技有限公司" });
    db.addCandidate("c2", "t1", { status: "NO_CONTACT", phone: null, companyName: "某某集团公司" });
    let calls = 0;
    const tianyancha = {
      client: {
        // 含「集团」的公司模拟无果，其余命中；计数随真实调用递增
        lookupCompany: vi.fn(async (companyName: string) => {
          calls += 1;
          return companyName.includes("集团")
            ? { found: false, phone: null, legalPerson: null, regAddress: null, raw: { mock: true } }
            : { found: true, phone: "13957881234", legalPerson: "陈某某", regAddress: "浙江省宁波市鄞州区", raw: { mock: true } };
        }),
        todayCallCount: () => calls,
      } satisfies TianyanchaClient,
    };

    const result = await reverseLookupCandidates(buildUser(), "t1", ["c1", "c2"], { prisma: db.prisma, tianyancha: tianyancha.client });

    expect(result).toMatchObject({ lookedUp: 2, found: 1, failed: 1, remainingQuota: 3 });
    expect(db.candidates[0].status).toBe("LOOKUP_FOUND");
    expect(db.candidates[0].phone).toBe("13957881234");
    expect(db.candidates[1].status).toBe("LOOKUP_FAILED");
    expect(db.operationLogs).toHaveLength(1);
    expect(db.operationLogs[0].action).toBe("LEAD_HUNTER_REVERSE_LOOKUP");
  });
});
