import { describe, expect, it } from "vitest";
import {
  buildLeadWriteItem,
  canonicalLeadPayloadHash,
  deriveLeadIdempotencyKey,
  parseLeadScore,
} from "./lead-scoring-contract.mjs";

const validScore = {
  aiScore: 86,
  profile: {
    industry: "金属加工",
    intent: "明确询价",
    scale: "中型制造企业",
    contactability: "电话和邮箱完整",
    confidence: "high",
    reason: "行业匹配且存在采购信号",
  },
  contactName: "张经理",
  phone: "13800000000",
  email: "lead@example.invalid",
};

function sourceUrlOfLength(length) {
  const prefix = "https://example.invalid/";
  return `${prefix}${"a".repeat(length - prefix.length)}`;
}

describe("model-neutral Lead scoring contract", () => {
  it("accepts only the strict versioned scoring object", () => {
    expect(parseLeadScore(JSON.stringify(validScore))).toEqual(validScore);
  });

  it.each([
    ["标准省市", { province: "江苏省", city: "无锡市" }],
    ["标准省且 city 为空", { province: "江苏省" }],
  ])("accepts and preserves optional %s in the strict profile", (_label, region) => {
    const score = { ...validScore, profile: { ...validScore.profile, ...region } };
    const parsed = parseLeadScore(JSON.stringify(score));
    expect(parsed.profile).toEqual(score.profile);
  });

  it.each([
    ["省份简称", { province: "江苏" }],
    ["缺少 province", { city: "无锡市" }],
    ["非法省市组合", { province: "江苏省", city: "广州市" }],
  ])("rejects %s instead of writing an unresolved region", (_label, region) => {
    const score = { ...validScore, profile: { ...validScore.profile, ...region } };
    expect(() => parseLeadScore(JSON.stringify(score))).toThrow(/invalid/iu);
  });

  it("rejects prose, fenced JSON, extra keys, partial profiles and invalid scores", () => {
    expect(() => parseLeadScore(`评分如下：${JSON.stringify(validScore)}`)).toThrow(/strict JSON/i);
    expect(() => parseLeadScore("```json\n" + JSON.stringify(validScore) + "\n```"))
      .toThrow(/strict JSON/i);
    expect(() => parseLeadScore(JSON.stringify({ ...validScore, commentary: "extra" }))).toThrow(/invalid/i);
    expect(() => parseLeadScore(JSON.stringify({
      ...validScore,
      profile: { ...validScore.profile, reason: undefined },
    }))).toThrow(/invalid/i);
    expect(() => parseLeadScore(JSON.stringify({ ...validScore, aiScore: 86.5 }))).toThrow(/invalid/i);
    expect(() => parseLeadScore(JSON.stringify({ ...validScore, aiScore: 101 }))).toThrow(/invalid/i);
  });

  it("builds the exact lead_upsert item with model and extractor versions", () => {
    const idempotencyKey = deriveLeadIdempotencyKey({
      sourceSystem: "n8n-baidu-lead-staging",
      externalLeadId: "baidu-result-0001",
    });
    const item = buildLeadWriteItem({
      sourceLead: {
        idempotencyKey,
        requestId: "trace-request-0001",
        companyName: "山东测试机床有限公司",
        source: "BAIDU_SEARCH",
        sourceUrl: "https://example.invalid/company/1",
        searchKeyword: "数控机床采购",
        sourceSystem: "n8n-baidu-lead-staging",
        externalLeadId: "baidu-result-0001",
      },
      score: validScore,
      sourceModelVersion: "deepseek-chat@2026-08",
      extractorVersion: "lead-score-v1",
    });

    expect(item).toMatchObject({
      idempotencyKey,
      companyName: "山东测试机床有限公司",
      aiScore: 86,
      profile: validScore.profile,
      sourceModelVersion: "deepseek-chat@2026-08",
      extractorVersion: "lead-score-v1",
    });
    expect(item.payloadHash).toBe(canonicalLeadPayloadHash(Object.fromEntries(
      Object.entries(item).filter(([key]) => !["idempotencyKey", "payloadHash"].includes(key)),
    )));
  });

  it("keeps validated province/city in the final Lead payload and its hash", () => {
    const score = {
      ...validScore,
      profile: { ...validScore.profile, province: "江苏省", city: "无锡市" },
    };
    const item = buildLeadWriteItem({
      sourceLead: {
        idempotencyKey: "lead-region-payload-0001",
        companyName: "江阴标准地区测试有限公司",
        source: "BAIDU_SEARCH",
        sourceSystem: "n8n-test",
        externalLeadId: "region-payload-1",
      },
      score,
      sourceModelVersion: "mock-model-v1",
      extractorVersion: "lead-score-v1",
    });

    expect(item.profile).toMatchObject({ province: "江苏省", city: "无锡市" });
    expect(item.payloadHash).toBe(canonicalLeadPayloadHash(Object.fromEntries(
      Object.entries(item).filter(([key]) => !["idempotencyKey", "payloadHash"].includes(key)),
    )));
  });

  it.each([191, 192, 2_048])("preserves a valid %i-character sourceUrl before hashing", (length) => {
    const sourceUrl = sourceUrlOfLength(length);
    const item = buildLeadWriteItem({
      sourceLead: {
        idempotencyKey: `lead-source-url-${length}`,
        companyName: "长链接评分契约测试",
        source: "BAIDU_SEARCH",
        sourceUrl,
        sourceSystem: "n8n-test",
        externalLeadId: `source-url-${length}`,
      },
      score: validScore,
      sourceModelVersion: "mock-model-v1",
      extractorVersion: "lead-score-v1",
    });

    expect(item.sourceUrl).toBe(sourceUrl);
    expect(item.payloadHash).toBe(canonicalLeadPayloadHash(Object.fromEntries(
      Object.entries(item).filter(([key]) => !["idempotencyKey", "payloadHash"].includes(key)),
    )));
  });

  it.each([
    ["2049 字符", sourceUrlOfLength(2_049)],
    ["非 HTTP(S) URL", "ftp://example.invalid/lead"],
    ["非法 URL", "not-a-url"],
    ["会被 trim 改写的 URL", " https://example.invalid/lead "],
  ])("rejects %s before payload hashing", (_label, sourceUrl) => {
    expect(() => buildLeadWriteItem({
      sourceLead: {
        idempotencyKey: "lead-source-url-invalid",
        companyName: "非法长链接评分契约测试",
        source: "BAIDU_SEARCH",
        sourceUrl,
        sourceSystem: "n8n-test",
        externalLeadId: "source-url-invalid",
      },
      score: validScore,
      sourceModelVersion: "mock-model-v1",
      extractorVersion: "lead-score-v1",
    })).toThrow();
  });

  it("derives a stable key and forbids using X-Dachuan-Request-Id as that key", () => {
    const source = { sourceSystem: "n8n-baidu-lead-staging", externalLeadId: "baidu-0002" };
    expect(deriveLeadIdempotencyKey(source)).toBe(deriveLeadIdempotencyKey(source));
    expect(deriveLeadIdempotencyKey(source)).toMatch(/^lead-v1-[a-f0-9]{64}$/);
    expect(() => buildLeadWriteItem({
      sourceLead: {
        idempotencyKey: "trace-request-0001",
        requestId: "trace-request-0001",
        companyName: "测试公司",
        source: "OTHER",
        sourceSystem: "n8n-test",
        externalLeadId: "test-1",
      },
      score: validScore,
      sourceModelVersion: "mock-model-v1",
      extractorVersion: "lead-score-v1",
    })).toThrow(/request id/i);
  });
});
