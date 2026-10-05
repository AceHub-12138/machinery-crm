import { describe, expect, it, vi } from "vitest";
import {
  formatProcessRulesSection,
  getNcProgramTemplates,
  listProcessRules,
  searchMachineCapabilities,
  type KnowledgeDb,
} from "@/lib/agent/knowledge/queries";

function buildDb() {
  return {
    machineCapability: {
      findMany: vi.fn(async (_query?: Record<string, unknown>) => [{ model: "BK5040", maxStrokeLengthMm: 400 }]),
      count: vi.fn(async (_query?: Record<string, unknown>) => 25),
    },
    processRuleCard: {
      findMany: vi.fn(async (_query?: Record<string, unknown>) => [
        {
          ruleNo: "R001",
          conditionText: "工件具有多个键槽（花键）需要加工",
          recommendModels: "数控插床",
          recommendProcess: "常规插削，选配旋转工作台",
          notRecommended: null,
          rationale: "一次装夹完成多个键槽",
        },
      ]),
      count: vi.fn(async (_query?: Record<string, unknown>) => 1),
    },
    ncProgramTemplate: {
      findMany: vi.fn(async (_query?: Record<string, unknown>) => [{ system: "GSK", name: "标准插削", program: "M60；" }]),
    },
  };
}

function asKnowledgeDb(db: ReturnType<typeof buildDb>): KnowledgeDb {
  return db as unknown as KnowledgeDb;
}

describe("searchMachineCapabilities", () => {
  it("按型号查询 = 详情模式：返回全字段（不带 select）", async () => {
    const db = buildDb();
    const result = await searchMachineCapabilities(asKnowledgeDb(db), { model: "BK5040" });

    const query = db.machineCapability.findMany.mock.calls[0][0] as { where: unknown; select?: unknown; take?: number };
    expect(query.where).toEqual({ AND: [{ model: { contains: "BK5040" } }] });
    expect(query.select).toBeUndefined();
    expect(result).toMatchObject({ total: 25, returned: 1 });
  });

  it("能力筛选条件进入 where（插削长度 gte / 模数 gte / 外齿直径 gte）", async () => {
    const db = buildDb();
    await searchMachineCapabilities(asKnowledgeDb(db), {
      minStrokeLengthMm: 320,
      maxModuleMm: 6,
      maxOuterGearDiaMm: 250,
    });

    const query = db.machineCapability.findMany.mock.calls[0][0] as { where: { AND: unknown[] } };
    expect(query.where.AND).toEqual([
      { maxStrokeLengthMm: { gte: 320 } },
      { maxModuleMm: { gte: 6 } },
      { maxOuterGearDiaMm: { gte: 250 } },
    ]);
  });

  it("关键词在加工对象/全称/选配里做 OR 匹配；无条件时查全量且限制条数", async () => {
    const db = buildDb();
    await searchMachineCapabilities(asKnowledgeDb(db), { keyword: "键槽", limit: 30 });

    const query = db.machineCapability.findMany.mock.calls[0][0] as { where: { AND: Array<{ OR: Array<Record<string, unknown>> }> }; take?: number; select?: unknown };
    expect(query.where.AND[0].OR.map((clause: { mainObjects?: unknown }) => Object.keys(clause)[0])).toEqual([
      "mainObjects",
      "fullName",
      "optionsText",
    ]);
    expect(query.take).toBe(30);
    expect(query.select).toBeDefined();
  });
});

describe("listProcessRules", () => {
  it("只取启用规则并按 sortOrder 排序", async () => {
    const db = buildDb();
    const result = await listProcessRules(asKnowledgeDb(db));

    expect(db.processRuleCard.findMany.mock.calls[0][0]).toEqual({
      where: { enabled: true },
      orderBy: [{ sortOrder: "asc" }],
      take: 20,
    });
    expect(result.rules[0]?.ruleNo).toBe("R001");
  });
});

describe("getNcProgramTemplates", () => {
  it("按系统 + 关键词过滤", async () => {
    const db = buildDb();
    await getNcProgramTemplates(asKnowledgeDb(db), { system: "GSK", keyword: "拼刀" });

    expect((db.ncProgramTemplate.findMany.mock.calls[0][0] as { where: unknown }).where).toEqual({
      system: "GSK",
      name: { contains: "拼刀" },
    });
  });
});

describe("formatProcessRulesSection", () => {
  it("空规则库返回空串（不占提示词）", () => {
    expect(formatProcessRulesSection([])).toBe("");
  });

  it("规则格式化为可读段落，含编号/条件/推荐/依据", () => {
    const section = formatProcessRulesSection([
      {
        id: "1",
        ruleNo: "R001",
        conditionText: "工件具有多个键槽（花键）需要加工",
        recommendModels: "数控插床",
        recommendProcess: "选配旋转工作台",
        notRecommended: null,
        rationale: "一次装夹完成多个键槽",
        enabled: true,
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);
    expect(section).toContain("R001");
    expect(section).toContain("多个键槽");
    expect(section).toContain("数控插床");
    expect(section).toContain("一次装夹完成多个键槽");
    // 空字段不出现在文本里
    expect(section).not.toContain("不推荐/禁止");
  });
});
