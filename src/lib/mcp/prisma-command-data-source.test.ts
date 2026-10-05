import { describe, expect, it, vi } from "vitest";
import {
  canonicalLeadPayloadHash,
  createPrismaLeadCommandDataSource,
} from "@/lib/mcp/prisma-command-data-source";

function commandItem() {
  const payload = {
    companyName: "山东事务测试机床有限公司",
    contactName: "王经理",
    phone: "13800000000",
    email: "lead@example.com",
    source: "BAIDU_SEARCH" as const,
    searchKeyword: "数控机床",
    aiScore: 91,
    profile: { industry: "机械制造" },
    sourceModelVersion: "model-3",
    extractorVersion: "extractor-3",
    sourceSystem: "internal-crawler",
    externalLeadId: "crawler-1001",
  };
  return {
    idempotencyKey: "lead-import-20260814-1001",
    payloadHash: canonicalLeadPayloadHash(payload),
    ...payload,
  };
}

function rehashItem<T extends {
  idempotencyKey: string;
  payloadHash: string;
  companyName: string;
  source: "BAIDU_SEARCH" | "MANUAL" | "OTHER";
}>(item: T): T {
  const { idempotencyKey: _idempotencyKey, payloadHash: _payloadHash, ...payload } = item;
  return { ...item, payloadHash: canonicalLeadPayloadHash(payload) };
}

function prismaFixture(users: Array<Record<string, unknown>> = []) {
  const leads: Array<Record<string, unknown>> = [];
  const idempotencies: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const client = {
    user: {
      findMany: vi.fn().mockResolvedValue(users),
    },
    lead: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, string> }) => leads.find((lead) => (
        (where.id && lead.id === where.id)
        || (where.idempotencyKey && lead.idempotencyKey === where.idempotencyKey)
        || (where.dedupKey && lead.dedupKey === where.dedupKey)
      )) ?? null),
      findMany: vi.fn(async () => [...leads]),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const lead = { id: `lead-${leads.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        leads.push(lead);
        return lead;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const index = leads.findIndex((lead) => lead.id === where.id);
        if (index < 0) throw new Error("Lead not found");
        leads[index] = { ...leads[index], ...data, updatedAt: new Date() };
        return leads[index];
      }),
    },
    leadWriteIdempotency: {
      findUnique: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) => (
        idempotencies.find((entry) => entry.idempotencyKey === where.idempotencyKey) ?? null
      )),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (idempotencies.some((entry) => entry.idempotencyKey === data.idempotencyKey)) {
          throw { code: "P2002", meta: { target: ["idempotencyKey"] } };
        }
        const entry = { createdAt: new Date(), ...data };
        idempotencies.push(entry);
        return entry;
      }),
    },
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const [, principalType, principalId, action, entityType, entityId, idempotencyKey, outcome, routingOutcome, payloadHash, requestId] = values;
      audits.push({
        principalType,
        principalId,
        action,
        entityType,
        entityId,
        idempotencyKey,
        outcome,
        routingOutcome,
        payloadHash,
        requestId,
        sql: strings.join("?"),
      });
      return 1;
    }),
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => (
      leads.filter((lead) => lead.id === values[0])
    )),
    $transaction: vi.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(client)),
  };
  return { client, leads, idempotencies, audits };
}

describe("Prisma Lead command data source", () => {
  it("writes every CREATE, MERGE, REPLAY and CONFLICT audit with an explicit UTC database timestamp", async () => {
    const fixture = prismaFixture();
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const created = commandItem();
    const merged = rehashItem({
      ...commandItem(),
      idempotencyKey: "lead-import-utc-audit-merge",
      externalLeadId: "utc-audit-merge",
      searchKeyword: "UTC merge",
    });
    const conflict = rehashItem({ ...created, companyName: "UTC 冲突企业" });
    const context = {
      requestId: "lead-write-utc-audit",
      principal: {
        principalType: "SERVICE" as const,
        principalId: "ai-lead-ingestor",
        scopes: ["lead:create"],
        jti: "jti-utc-audit",
      },
    };

    await dataSource.executeCommand("lead_upsert", { items: [created] }, context);
    await dataSource.executeCommand("lead_upsert", { items: [merged] }, context);
    await dataSource.executeCommand("lead_upsert", { items: [created] }, context);
    await expect(dataSource.executeCommand("lead_upsert", { items: [conflict] }, context))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    expect(fixture.audits.map((entry) => entry.outcome)).toEqual(["CREATED", "CREATED", "REPLAY", "CONFLICT"]);
    expect(fixture.audits).toHaveLength(4);
    for (const entry of fixture.audits) {
      expect(entry.sql).toMatch(/\bcreatedAt\b/iu);
      expect(entry.sql).toMatch(/\bUTC_TIMESTAMP\(3\)/iu);
      expect(entry.sql).not.toMatch(/\bCURRENT_TIMESTAMP\b/iu);
    }
  });

  it("computes the same payloadHash regardless of object key order", () => {
    expect(canonicalLeadPayloadHash({ companyName: "顺序测试", source: "OTHER", profile: { b: 2, a: 1 } }))
      .toBe(canonicalLeadPayloadHash({ profile: { a: 1, b: 2 }, source: "OTHER", companyName: "顺序测试" }));
  });

  it("creates a new Lead and its CREATED service audit atomically", async () => {
    const fixture = prismaFixture();
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const item = commandItem();

    const result = await dataSource.executeCommand("lead_upsert", { items: [item] }, {
      requestId: "lead-write-request-1001",
      principal: {
        principalType: "SERVICE",
        principalId: "ai-lead-ingestor",
        scopes: ["lead:create"],
        jti: "jti-1001",
      },
    }) as { items: Array<{ id: string; replay: boolean; writeDisposition: string; routingOutcome: string | null }> };

    expect(result.items).toEqual([expect.objectContaining({
      id: "lead-1",
      replay: false,
      writeDisposition: "CREATED",
      routingOutcome: "REGION_UNRESOLVED",
    })]);
    expect(fixture.leads).toEqual([
      expect.objectContaining({
        companyName: item.companyName,
        idempotencyKey: item.idempotencyKey,
        payloadHash: item.payloadHash,
        dedupStatus: "UNIQUE",
      }),
    ]);
    expect(fixture.audits).toEqual([
      expect.objectContaining({
        principalType: "SERVICE",
        principalId: "ai-lead-ingestor",
        action: "AUTO_ASSIGN_FAILED|old=-|new=-|reason=REGION_UNRESOLVED",
        entityType: "Lead",
        entityId: "lead-1",
        idempotencyKey: item.idempotencyKey,
        outcome: "CREATED",
        routingOutcome: "REGION_UNRESOLVED",
        payloadHash: item.payloadHash,
        requestId: "lead-write-request-1001",
      }),
    ]);
  });

  it("新 Lead 使用明确 profile 省市匹配唯一销售并记录 AUTO_ASSIGN", async () => {
    const fixture = prismaFixture([{
      id: "sales-east",
      role: "SALES",
      isActive: true,
      territories: [{ province: "山东省", cities: ["济南市"] }],
    }]);
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const item = rehashItem({
      ...commandItem(),
      idempotencyKey: "lead-import-20260824-auto-assign",
      profile: { industry: "机械制造", province: "山东省", city: "济南市" },
    });

    const result = await dataSource.executeCommand("lead_upsert", { items: [item] }, {
      requestId: "lead-write-auto-assign",
      principal: { principalType: "SERVICE", principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-auto" },
    }) as { items: Array<{ writeDisposition: string; routingOutcome: string | null }> };

    expect(result.items).toEqual([expect.objectContaining({ writeDisposition: "CREATED", routingOutcome: "ASSIGNED" })]);
    expect(fixture.leads).toEqual([expect.objectContaining({ assignedUserId: "sales-east" })]);
    expect(fixture.audits).toEqual([expect.objectContaining({
      action: "AUTO_ASSIGN|old=-|new=sales-east",
      entityId: "lead-1",
      outcome: "CREATED",
      routingOutcome: "ASSIGNED",
    })]);
  });

  it("明确地区没有匹配负责人时正常创建未指派 Lead 并审计失败原因", async () => {
    const fixture = prismaFixture([]);
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const item = rehashItem({
      ...commandItem(),
      idempotencyKey: "lead-import-20260824-no-assignee",
      profile: { province: "山东省", city: "济南市" },
    });
    await dataSource.executeCommand("lead_upsert", { items: [item] }, {
      requestId: "lead-write-no-assignee",
      principal: { principalType: "SERVICE", principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-no-assignee" },
    });
    expect(fixture.leads[0]).toEqual(expect.objectContaining({ assignedUserId: null }));
    expect(fixture.audits[0]).toEqual(expect.objectContaining({
      action: "AUTO_ASSIGN_FAILED|old=-|new=-|reason=NO_MATCHING_ASSIGNEE",
      routingOutcome: "NO_MATCHING_ASSIGNEE",
    }));
  });

  it("路由查询不可用时不阻断 Lead 创建并记录 ROUTING_UNAVAILABLE", async () => {
    const fixture = prismaFixture();
    fixture.client.user.findMany.mockRejectedValue(new Error("permission denied"));
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const item = rehashItem({
      ...commandItem(),
      idempotencyKey: "lead-import-20260824-routing-unavailable",
      profile: { province: "山东省", city: "济南市" },
    });
    await dataSource.executeCommand("lead_upsert", { items: [item] }, {
      requestId: "lead-write-routing-unavailable",
      principal: { principalType: "SERVICE", principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-routing-unavailable" },
    });
    expect(fixture.leads[0]).toEqual(expect.objectContaining({ assignedUserId: null }));
    expect(fixture.audits[0]).toEqual(expect.objectContaining({
      action: "AUTO_ASSIGN_FAILED|old=-|new=-|reason=ROUTING_UNAVAILABLE",
      routingOutcome: "ROUTING_UNAVAILABLE",
    }));
  });

  it("幂等 REPLAY 不重新查询或重复自动分配副作用", async () => {
    const fixture = prismaFixture([{
      id: "sales-east",
      role: "SALES",
      isActive: true,
      territories: [{ province: "山东省", cities: [] }],
    }]);
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const item = rehashItem({
      ...commandItem(),
      idempotencyKey: "lead-import-20260824-auto-replay",
      profile: { province: "山东省" },
    });
    const context = {
      requestId: "lead-write-auto-replay",
      principal: { principalType: "SERVICE" as const, principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-auto-replay" },
    };
    await dataSource.executeCommand("lead_upsert", { items: [item] }, context);
    fixture.client.user.findMany.mockClear();
    await dataSource.executeCommand("lead_upsert", { items: [item] }, context);
    expect(fixture.client.user.findMany).not.toHaveBeenCalled();
    expect(fixture.leads).toHaveLength(1);
    expect(fixture.leads[0]).toEqual(expect.objectContaining({ assignedUserId: "sales-east" }));
    expect(fixture.audits.map((entry) => entry.action)).toEqual([
      "AUTO_ASSIGN|old=-|new=sales-east",
      "LEAD_UPSERT",
    ]);
  });

  it("同公司新幂等键合并既有 Lead 时不重新改派", async () => {
    const fixture = prismaFixture([{
      id: "sales-east",
      role: "SALES",
      isActive: true,
      territories: [{ province: "山东省", cities: [] }],
    }]);
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const first = commandItem();
    const second = rehashItem({
      ...commandItem(),
      idempotencyKey: "lead-import-20260824-dedup-no-reassign",
      externalLeadId: "dedup-no-reassign",
      profile: { province: "山东省" },
    });
    const context = {
      requestId: "lead-write-dedup-no-reassign",
      principal: { principalType: "SERVICE" as const, principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-dedup-no-reassign" },
    };
    await dataSource.executeCommand("lead_upsert", { items: [first] }, context);
    fixture.client.user.findMany.mockClear();
    await dataSource.executeCommand("lead_upsert", { items: [second] }, context);
    expect(fixture.client.user.findMany).not.toHaveBeenCalled();
    expect(fixture.leads).toHaveLength(1);
    expect(fixture.leads[0].assignedUserId).toBeNull();
    expect(fixture.audits.at(-1)).toEqual(expect.objectContaining({ action: "LEAD_UPSERT" }));
  });

  it("returns the original Lead with replay=true for the same key and hash", async () => {
    const fixture = prismaFixture();
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const item = commandItem();
    const context = {
      requestId: "lead-write-request-replay",
      principal: { principalType: "SERVICE" as const, principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-replay" },
    };

    await dataSource.executeCommand("lead_upsert", { items: [item] }, context);
    const replay = await dataSource.executeCommand("lead_upsert", { items: [item] }, context) as {
      items: Array<{ id: string; replay: boolean; writeDisposition: string; routingOutcome: string | null }>;
    };

    expect(replay.items).toEqual([expect.objectContaining({
      id: "lead-1",
      replay: true,
      writeDisposition: "REPLAY",
      routingOutcome: null,
    })]);
    expect(fixture.leads).toHaveLength(1);
    expect(fixture.audits.map((entry) => entry.outcome)).toEqual(["CREATED", "REPLAY"]);
  });

  it("rejects the same key with a different hash and commits a CONFLICT audit", async () => {
    const fixture = prismaFixture();
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const item = commandItem();
    const context = {
      requestId: "lead-write-request-conflict",
      principal: { principalType: "SERVICE" as const, principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-conflict" },
    };
    await dataSource.executeCommand("lead_upsert", { items: [item] }, context);
    fixture.client.user.findMany.mockClear();
    const conflictingPayload = { ...item, companyName: "另一家公司" };
    conflictingPayload.payloadHash = canonicalLeadPayloadHash({
      companyName: conflictingPayload.companyName,
      contactName: conflictingPayload.contactName,
      phone: conflictingPayload.phone,
      email: conflictingPayload.email,
      source: conflictingPayload.source,
      searchKeyword: conflictingPayload.searchKeyword,
      aiScore: conflictingPayload.aiScore,
      profile: conflictingPayload.profile,
      sourceModelVersion: conflictingPayload.sourceModelVersion,
      extractorVersion: conflictingPayload.extractorVersion,
      sourceSystem: conflictingPayload.sourceSystem,
      externalLeadId: conflictingPayload.externalLeadId,
    });

    await expect(dataSource.executeCommand("lead_upsert", { items: [conflictingPayload] }, context)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(fixture.leads).toHaveLength(1);
    expect(fixture.client.user.findMany).not.toHaveBeenCalled();
    expect(fixture.audits.at(-1)).toEqual(expect.objectContaining({
      entityId: "lead-1",
      outcome: "CONFLICT",
      payloadHash: conflictingPayload.payloadHash,
    }));
  });

  it("merges a new phone into the same Lead when the company already exists", async () => {
    const fixture = prismaFixture();
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const first = rehashItem({ ...commandItem(), phone: undefined });
    const second = rehashItem({
      ...commandItem(),
      idempotencyKey: "lead-import-20260814-1002",
      externalLeadId: "crawler-1002",
      phone: "13900000000",
    });
    const context = {
      requestId: "lead-write-request-dedup",
      principal: { principalType: "SERVICE" as const, principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-dedup" },
    };

    const created = await dataSource.executeCommand("lead_upsert", { items: [first] }, context) as {
      items: Array<{ writeDisposition: string; replay: boolean; routingOutcome: string | null }>;
    };
    const merged = await dataSource.executeCommand("lead_upsert", { items: [second] }, context) as {
      items: Array<{ writeDisposition: string; replay: boolean; routingOutcome: string | null }>;
    };

    expect(created.items[0]).toMatchObject({ writeDisposition: "CREATED", replay: false });
    expect(merged.items[0]).toMatchObject({ writeDisposition: "MERGED", replay: false, routingOutcome: null });
    expect(fixture.leads).toHaveLength(1);
    expect(fixture.leads[0].dedupKey).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.leads[0]).toEqual(expect.objectContaining({
      id: "lead-1",
      phone: "13900000000",
      duplicateOfLeadId: null,
      dedupStatus: "UNIQUE",
    }));
  });

  it("normalizes company punctuation while preserving existing contacts and refreshing valid scoring", async () => {
    const fixture = prismaFixture();
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const first = rehashItem({
      ...commandItem(),
      companyName: "山东事务测试机床（有限公司）",
      sourceUrl: "https://example.com/original-source",
      profile: { industry: "机械制造", confidence: "medium" },
    });
    const second = rehashItem({
      ...commandItem(),
      idempotencyKey: "lead-import-20260814-contact-preserve",
      companyName: "山东事务测试机床有限公司",
      sourceUrl: "https://example.com/new-source-must-not-overwrite",
      contactName: "李经理",
      phone: "13900000000",
      email: "new@example.com",
      aiScore: 97,
      profile: { industry: "机床制造", confidence: "high" },
      sourceModelVersion: "model-4",
      extractorVersion: "extractor-4",
      externalLeadId: "crawler-contact-preserve",
    });
    const context = {
      requestId: "lead-write-request-contact-preserve",
      principal: { principalType: "SERVICE" as const, principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-contact-preserve" },
    };

    await dataSource.executeCommand("lead_upsert", { items: [first] }, context);
    await dataSource.executeCommand("lead_upsert", { items: [second] }, context);

    expect(fixture.leads).toHaveLength(1);
    expect(fixture.leads[0]).toEqual(expect.objectContaining({
      companyName: first.companyName,
      contactName: first.contactName,
      phone: first.phone,
      email: first.email,
      sourceUrl: first.sourceUrl,
      sourceSystem: first.sourceSystem,
      externalLeadId: first.externalLeadId,
      aiScore: 97,
      profile: second.profile,
      sourceModelVersion: "model-4",
      extractorVersion: "extractor-4",
    }));
  });

  it("accumulates distinct search keywords on one Lead without exceeding the field limit", async () => {
    const fixture = prismaFixture();
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const first = commandItem();
    const second = rehashItem({
      ...commandItem(),
      idempotencyKey: "lead-import-20260814-keyword-2",
      searchKeyword: "龙门加工中心",
      externalLeadId: "crawler-keyword-2",
    });
    const repeated = rehashItem({
      ...commandItem(),
      idempotencyKey: "lead-import-20260814-keyword-3",
      searchKeyword: "龙门加工中心",
      externalLeadId: "crawler-keyword-3",
    });
    const context = {
      requestId: "lead-write-request-keywords",
      principal: { principalType: "SERVICE" as const, principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-keywords" },
    };

    await dataSource.executeCommand("lead_upsert", { items: [first] }, context);
    await dataSource.executeCommand("lead_upsert", { items: [second] }, context);
    await dataSource.executeCommand("lead_upsert", { items: [repeated] }, context);

    expect(fixture.leads).toHaveLength(1);
    expect(fixture.leads[0].searchKeyword).toBe("数控机床；龙门加工中心");
    expect(String(fixture.leads[0].searchKeyword)).toHaveLength(11);
  });

  it("preserves the existing keyword instead of writing a truncated entry past 191 characters", async () => {
    const fixture = prismaFixture();
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const first = rehashItem({ ...commandItem(), searchKeyword: "甲".repeat(191) });
    const second = rehashItem({
      ...commandItem(),
      idempotencyKey: "lead-import-20260814-keyword-limit",
      searchKeyword: "乙",
      externalLeadId: "crawler-keyword-limit",
    });
    const context = {
      requestId: "lead-write-request-keyword-limit",
      principal: { principalType: "SERVICE" as const, principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-keyword-limit" },
    };

    await dataSource.executeCommand("lead_upsert", { items: [first, second] }, context);

    expect(fixture.leads).toHaveLength(1);
    expect(fixture.leads[0].searchKeyword).toBe(first.searchKeyword);
    expect(String(fixture.leads[0].searchKeyword)).toHaveLength(191);
  });

  it("replays and conflicts on a later idempotency key that merged into the original Lead", async () => {
    const fixture = prismaFixture();
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const first = commandItem();
    const merged = rehashItem({
      ...commandItem(),
      idempotencyKey: "lead-import-20260814-merged-key",
      phone: "13900000000",
      externalLeadId: "crawler-merged-key",
    });
    const context = {
      requestId: "lead-write-request-merged-idempotency",
      principal: { principalType: "SERVICE" as const, principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-merged-idempotency" },
    };

    await dataSource.executeCommand("lead_upsert", { items: [first] }, context);
    const mergedResult = await dataSource.executeCommand("lead_upsert", { items: [merged] }, context) as {
      items: Array<{ id: string; replay: boolean }>;
    };
    const replay = await dataSource.executeCommand("lead_upsert", { items: [merged] }, context) as {
      items: Array<{ id: string; replay: boolean }>;
    };
    const conflicting = rehashItem({ ...merged, aiScore: 12 });

    expect(mergedResult.items).toEqual([expect.objectContaining({ id: "lead-1", replay: false })]);
    expect(replay.items).toEqual([expect.objectContaining({ id: "lead-1", replay: true })]);
    await expect(dataSource.executeCommand("lead_upsert", { items: [conflicting] }, context)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(fixture.leads).toHaveLength(1);
    expect(fixture.audits.map((entry) => entry.outcome)).toEqual(["CREATED", "CREATED", "REPLAY", "CONFLICT"]);
  });

  it("creates separate Leads for strictly different normalized company names", async () => {
    const fixture = prismaFixture();
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const first = commandItem();
    const second = rehashItem({
      ...commandItem(),
      idempotencyKey: "lead-import-20260814-other-company",
      companyName: "山东另一家机床有限公司",
      externalLeadId: "crawler-other-company",
    });
    const context = {
      requestId: "lead-write-request-other-company",
      principal: { principalType: "SERVICE" as const, principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-other-company" },
    };

    await dataSource.executeCommand("lead_upsert", { items: [first, second] }, context);

    expect(fixture.leads).toHaveLength(2);
    expect(new Set(fixture.leads.map((lead) => lead.dedupKey)).size).toBe(2);
  });

  it("uses NFKC lowercase and removes whitespace punctuation and symbols for exact company dedup", async () => {
    const fixture = prismaFixture();
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const first = rehashItem({ ...commandItem(), companyName: "ＡＢＣ Machine-Tool🚀（山东）有限公司" });
    const second = rehashItem({
      ...commandItem(),
      idempotencyKey: "lead-import-20260814-nfkc-company",
      companyName: "abc machinetool山东有限公司",
      externalLeadId: "crawler-nfkc-company",
    });
    const context = {
      requestId: "lead-write-request-nfkc-company",
      principal: { principalType: "SERVICE" as const, principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-nfkc-company" },
    };

    await dataSource.executeCommand("lead_upsert", { items: [first, second] }, context);

    expect(fixture.leads).toHaveLength(1);
    expect(fixture.leads[0].companyName).toBe(first.companyName);
  });

  it("rejects a company name that becomes empty after strict normalization", async () => {
    const fixture = prismaFixture();
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const item = rehashItem({ ...commandItem(), companyName: "！－🚀（ ）" });

    await expect(dataSource.executeCommand("lead_upsert", { items: [item] }, {
      requestId: "lead-write-request-empty-company",
      principal: { principalType: "SERVICE", principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-empty-company" },
    })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(fixture.leads).toHaveLength(0);
  });

  it("adopts an existing Lead that still has the legacy company-phone-email fingerprint", async () => {
    const fixture = prismaFixture();
    fixture.leads.push({
      id: "lead-legacy",
      companyName: "山东事务测试机床（有限公司）",
      contactName: null,
      phone: null,
      email: null,
      source: "BAIDU_SEARCH",
      sourceUrl: null,
      searchKeyword: "旧关键词",
      aiScore: 60,
      profile: { confidence: "medium" },
      sourceModelVersion: "legacy-model",
      extractorVersion: "legacy-extractor",
      sourceSystem: "legacy-source",
      externalLeadId: "legacy-external-id",
      idempotencyKey: "legacy-idempotency-key",
      payloadHash: "a".repeat(64),
      dedupKey: "legacy-company-phone-email-fingerprint",
      duplicateOfLeadId: null,
      duplicateConfidence: null,
      dedupStatus: "UNIQUE",
      createdAt: new Date("2026-08-14T00:00:00.000Z"),
      updatedAt: new Date("2026-08-14T00:00:00.000Z"),
    });
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const incoming = rehashItem({
      ...commandItem(),
      idempotencyKey: "lead-import-20260814-legacy-adoption",
      companyName: "山东事务测试机床有限公司",
      externalLeadId: "crawler-legacy-adoption",
    });

    const result = await dataSource.executeCommand("lead_upsert", { items: [incoming] }, {
      requestId: "lead-write-request-legacy-adoption",
      principal: { principalType: "SERVICE", principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-legacy-adoption" },
    }) as { items: Array<{ id: string; replay: boolean }> };

    expect(result.items).toEqual([expect.objectContaining({ id: "lead-legacy", replay: false })]);
    expect(fixture.leads).toHaveLength(1);
    expect(fixture.leads[0]).toEqual(expect.objectContaining({
      id: "lead-legacy",
      dedupKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      phone: incoming.phone,
    }));
  });

  it("merges into the historical root instead of creating a third Lead when a duplicate already exists", async () => {
    const fixture = prismaFixture();
    fixture.leads.push(
      {
        id: "lead-historical-root",
        companyName: "山东历史兼容机床（有限公司）",
        contactName: null,
        phone: null,
        email: null,
        source: "BAIDU_SEARCH",
        sourceUrl: null,
        searchKeyword: "历史根关键词",
        aiScore: 60,
        profile: { confidence: "medium" },
        sourceModelVersion: "legacy-model",
        extractorVersion: "legacy-extractor",
        sourceSystem: "legacy-source",
        externalLeadId: "legacy-root",
        idempotencyKey: "legacy-root-idempotency",
        payloadHash: "a".repeat(64),
        dedupKey: "legacy-root-company-phone-email-fingerprint",
        duplicateOfLeadId: null,
        duplicateConfidence: null,
        dedupStatus: "UNIQUE",
        createdAt: new Date("2026-08-14T00:00:00.000Z"),
        updatedAt: new Date("2026-08-14T00:00:00.000Z"),
      },
      {
        id: "lead-historical-duplicate",
        companyName: "山东历史兼容机床有限公司",
        contactName: "历史重复联系人",
        phone: "13700000000",
        email: null,
        source: "BAIDU_SEARCH",
        sourceUrl: null,
        searchKeyword: "历史重复关键词",
        aiScore: 55,
        profile: { confidence: "low" },
        sourceModelVersion: "legacy-model",
        extractorVersion: "legacy-extractor",
        sourceSystem: "legacy-source",
        externalLeadId: "legacy-duplicate",
        idempotencyKey: "legacy-duplicate-idempotency",
        payloadHash: "b".repeat(64),
        dedupKey: null,
        duplicateOfLeadId: "lead-historical-root",
        duplicateConfidence: 95,
        dedupStatus: "PENDING_REVIEW",
        // 旧 duplicate 即使更早，也不能替代明确的历史 root。
        createdAt: new Date("2026-08-13T00:00:00.000Z"),
        updatedAt: new Date("2026-08-13T00:00:00.000Z"),
      },
    );
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const incoming = rehashItem({
      ...commandItem(),
      idempotencyKey: "lead-import-20260814-historical-root-selection",
      companyName: "山东历史兼容机床有限公司",
      searchKeyword: "新版命中关键词",
      externalLeadId: "crawler-historical-root-selection",
    });

    const result = await dataSource.executeCommand("lead_upsert", { items: [incoming] }, {
      requestId: "lead-write-request-historical-root-selection",
      principal: { principalType: "SERVICE", principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-historical-root-selection" },
    }) as { items: Array<{ id: string; replay: boolean }> };

    expect(result.items).toEqual([expect.objectContaining({ id: "lead-historical-root", replay: false })]);
    expect(fixture.leads).toHaveLength(2);
    expect(fixture.leads.find((lead) => lead.id === "lead-historical-root")).toEqual(expect.objectContaining({
      dedupKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      searchKeyword: "历史根关键词；新版命中关键词",
    }));
    expect(fixture.leads.find((lead) => lead.id === "lead-historical-duplicate")).toEqual(expect.objectContaining({
      duplicateOfLeadId: "lead-historical-root",
      dedupStatus: "PENDING_REVIEW",
      searchKeyword: "历史重复关键词",
    }));
  });

  it("turns a concurrent idempotency-key P2002 race into a replay", async () => {
    const fixture = prismaFixture();
    const item = commandItem();
    fixture.client.lead.create.mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => {
      fixture.leads.push({ id: "lead-from-competitor", createdAt: new Date(), updatedAt: new Date(), ...data });
      throw { code: "P2002", meta: { target: ["idempotencyKey"] } };
    });
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);

    const result = await dataSource.executeCommand("lead_upsert", { items: [item] }, {
      requestId: "lead-write-request-race",
      principal: { principalType: "SERVICE", principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-race" },
    }) as { items: Array<{ id: string; replay: boolean }> };

    expect(result.items).toEqual([expect.objectContaining({ id: "lead-from-competitor", replay: true })]);
    expect(fixture.audits).toEqual([expect.objectContaining({ outcome: "REPLAY", entityId: "lead-from-competitor" })]);
  });

  it("retries a Prisma transaction write conflict before creating the Lead", async () => {
    const fixture = prismaFixture();
    fixture.client.$transaction.mockRejectedValueOnce({ code: "P2034" });
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);

    const result = await dataSource.executeCommand("lead_upsert", { items: [commandItem()] }, {
      requestId: "lead-write-request-transaction-retry",
      principal: { principalType: "SERVICE", principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-transaction-retry" },
    }) as { items: Array<{ id: string; replay: boolean }> };

    expect(result.items).toEqual([expect.objectContaining({ id: "lead-1", replay: false })]);
    expect(fixture.client.$transaction).toHaveBeenCalledTimes(2);
  });

  it("turns a concurrent company dedup-key P2002 race into one merged Lead", async () => {
    const fixture = prismaFixture();
    const item = commandItem();
    fixture.client.lead.create.mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => {
      fixture.leads.push({
        id: "lead-dedup-competitor",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
        idempotencyKey: "competitor-idempotency-key",
        payloadHash: "c".repeat(64),
      });
      throw { code: "P2002", meta: { target: ["dedupKey"] } };
    });
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);

    const result = await dataSource.executeCommand("lead_upsert", { items: [item] }, {
      requestId: "lead-write-request-dedup-race",
      principal: { principalType: "SERVICE", principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-dedup-race" },
    }) as { items: Array<{ id: string; replay: boolean; dedupStatus: string }> };

    expect(result.items).toEqual([expect.objectContaining({ id: "lead-dedup-competitor", replay: false, dedupStatus: "UNIQUE" })]);
    expect(fixture.leads).toHaveLength(1);
    expect(fixture.leads.at(-1)).toEqual(expect.objectContaining({
      id: "lead-dedup-competitor",
      dedupKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      duplicateOfLeadId: null,
      dedupStatus: "UNIQUE",
    }));
  });

  it("rejects a caller-supplied payloadHash that does not match the canonical business payload", async () => {
    const fixture = prismaFixture();
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);

    await expect(dataSource.executeCommand("lead_upsert", {
      items: [{ ...commandItem(), payloadHash: "0".repeat(64) }],
    }, {
      requestId: "lead-write-request-hash-mismatch",
      principal: { principalType: "SERVICE", principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-hash" },
    })).rejects.toMatchObject({ code: "PAYLOAD_HASH_MISMATCH" });
    expect(fixture.leads).toHaveLength(0);
    expect(fixture.audits).toHaveLength(0);
  });

  it("audits every identified replay and conflict before rejecting an atomic batch", async () => {
    const fixture = prismaFixture();
    const dataSource = createPrismaLeadCommandDataSource(fixture.client as never);
    const replay = commandItem();
    const firstExisting = rehashItem({
      ...commandItem(),
      idempotencyKey: "lead-import-20260814-existing-2",
      externalLeadId: "existing-2",
    });
    const secondExisting = rehashItem({
      ...commandItem(),
      idempotencyKey: "lead-import-20260814-existing-3",
      externalLeadId: "existing-3",
    });
    const context = {
      requestId: "lead-write-request-batch-conflict",
      principal: { principalType: "SERVICE" as const, principalId: "ai-lead-ingestor", scopes: ["lead:create"], jti: "jti-batch-conflict" },
    };
    await dataSource.executeCommand("lead_upsert", { items: [replay, firstExisting, secondExisting] }, context);
    fixture.audits.length = 0;
    const newItem = rehashItem({
      ...commandItem(),
      idempotencyKey: "lead-import-20260814-new-before-conflict",
      externalLeadId: "new-before-conflict",
    });
    const firstConflict = rehashItem({
      ...firstExisting,
      companyName: "第一家批次冲突公司",
    });
    const secondConflict = rehashItem({
      ...secondExisting,
      companyName: "第二家批次冲突公司",
    });

    await expect(dataSource.executeCommand("lead_upsert", {
      items: [newItem, replay, firstConflict, secondConflict],
    }, context)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(fixture.leads).toHaveLength(1);
    expect(fixture.audits).toEqual([
      expect.objectContaining({ outcome: "REPLAY", idempotencyKey: replay.idempotencyKey }),
      expect.objectContaining({ outcome: "CONFLICT", idempotencyKey: firstConflict.idempotencyKey }),
      expect.objectContaining({ outcome: "CONFLICT", idempotencyKey: secondConflict.idempotencyKey }),
    ]);
  });
});
