import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { admitCandidates } from "@/lib/lead-hunter/admit";
import type { SessionUser } from "@/lib/customer-permissions";
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
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 1),
    leadHuntCandidate: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => candidates.find((row) => row.id === where.id) ?? null),
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
      findFirst: vi.fn(async ({ where }: { where: { OR: Array<{ idempotencyKey?: string; dedupKey?: string }> } }) => [...leads.values()].find((lead) => where.OR.some((condition) => (condition.idempotencyKey && lead.idempotencyKey === condition.idempotencyKey) || (condition.dedupKey && lead.dedupKey === condition.dedupKey))) ?? null),
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
      snippet: "电话 13812345678",
      contactName: "王经理",
      phoneSource: null,
      phoneEvidence: null,
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

    expect((await admitCandidates(buildUser(), "t1", ["c1"], { prisma: db.prisma })).results[0]).toMatchObject({ status: "REJECTED", reason: expect.stringContaining("状态不允许入池") });
  });

  it("[AUDIT-A1] same-company conflict is ALREADY_IN_POOL and other rows still succeed", async () => {
    const db = createFakeDb(); db.addTask("t1", baseConfig); db.addCandidate("c1", "t1"); db.addCandidate("c2", "t1");
    const result = await admitCandidates(buildUser(), "t1", ["c1", "c2"], { prisma: db.prisma });
    expect(result.admitted).toBe(1); expect(result.results.map((row) => row.status)).toEqual(["ADMITTED", "ALREADY_IN_POOL"]);
    expect(result.results[1].leadId).toBe(result.results[0].leadId); expect(db.prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
  it("[AUDIT-A2] admits 88 without a phone unassigned, rejects 80", async () => {
    const db = createFakeDb(); db.addTask("t1", baseConfig);
    db.addCandidate("no", "t1", { phone: null, score: 88, status: "NO_CONTACT" });
    db.addCandidate("low", "t1", { companyName: "乙公司", phone: null, score: 80, status: "NO_CONTACT" });
    const result = await admitCandidates(buildUser(), "t1", ["no", "low"], { prisma: db.prisma });
    expect(result.results.map((row) => row.status)).toEqual(["ADMITTED", "REJECTED"]);
    expect([...db.leads.values()][0]).toMatchObject({ contactStatus: "PENDING_LOOKUP", assignedUserId: null, contactName: "王经理" });
    expect(db.operationLogs[0].action).toBe("AUTO_ASSIGN_DEFERRED|reason=NO_CONTACT");
  });
  it("rechecks historical phone evidence and drops an invented number", async () => {
    const db = createFakeDb(); db.addTask("t1", baseConfig); db.addCandidate("old", "t1", { snippet: "正文没有电话" });
    await admitCandidates(buildUser(), "t1", ["old"], { prisma: db.prisma });
    expect([...db.leads.values()][0]).toMatchObject({ phone: null, contactStatus: "PENDING_LOOKUP" });
  });
  it("rejects all obsolete lookup states and existing customer candidates", async () => {
    const db = createFakeDb(); db.addTask("t1", baseConfig);
    const states = ["LOOKUP_FOUND", "LOOKUP_FAILED", "LOOKING_UP", "EXISTING_CUSTOMER"];
    states.forEach((status) => db.addCandidate(status, "t1", { status }));
    expect((await admitCandidates(buildUser(), "t1", states, { prisma: db.prisma })).results.every((row) => row.status === "REJECTED")).toBe(true);
  });
});
