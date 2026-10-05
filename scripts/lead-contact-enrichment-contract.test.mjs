import { describe, expect, it } from "vitest";
import {
  buildInitialContactQuery,
  buildScoredRelatedLead,
  decideContactEnrichment,
  extractContactCandidates,
  normalizeStructuredRegion,
  parseContactVerifierV11Output,
  parseContactSearchConfig,
  parseContactVerifierOutput,
  parseQueryPlannerOutput,
  prepareContactSearchRound,
  runContactEnrichment,
} from "./lead-contact-enrichment-contract.mjs";

describe("Lead contact enrichment entry gate", () => {
  it.each([
    [95, "13800000000", undefined, { shouldWrite: true, shouldSearch: false, status: "CONTACT_SEARCH_NOT_REQUIRED" }],
    [95, undefined, "sales@example.com", { shouldWrite: true, shouldSearch: false, status: "CONTACT_SEARCH_NOT_REQUIRED" }],
    [95, undefined, undefined, { shouldWrite: false, shouldSearch: true, status: "CONTACT_SEARCH_STARTED" }],
    [90, undefined, undefined, { shouldWrite: false, shouldSearch: false, status: "CONTACT_SEARCH_NOT_REQUIRED" }],
    [85, undefined, undefined, { shouldWrite: false, shouldSearch: false, status: "CONTACT_SEARCH_NOT_REQUIRED" }],
    [85, "0537-1234567", undefined, { shouldWrite: true, shouldSearch: false, status: "CONTACT_SEARCH_NOT_REQUIRED" }],
    [79, "13800000000", undefined, { shouldWrite: false, shouldSearch: false, status: "CONTACT_SEARCH_NOT_REQUIRED" }],
  ])("applies the score and contact rules for score %s", (aiScore, phone, email, expected) => {
    expect(decideContactEnrichment({ aiScore, phone, email })).toMatchObject(expected);
  });
});

describe("Lead contact enrichment search budget", () => {
  it("checks the independent hard limit before every Baidu request", () => {
    const config = parseContactSearchConfig({});
    const first = prepareContactSearchRound({ contactSearchRound: 0, config });
    const second = prepareContactSearchRound({ contactSearchRound: 1, config });
    const third = prepareContactSearchRound({ contactSearchRound: 2, config });
    const exhausted = prepareContactSearchRound({ contactSearchRound: 3, config });

    expect([first.contactSearchRound, second.contactSearchRound, third.contactSearchRound]).toEqual([1, 2, 3]);
    expect([first.shouldSearch, second.shouldSearch, third.shouldSearch]).toEqual([true, true, true]);
    expect(exhausted).toMatchObject({
      contactSearchRound: 3,
      shouldSearch: false,
      status: "CONTACT_ENRICHMENT_EXHAUSTED",
    });
    expect(() => parseContactSearchConfig({ contact_search_max_rounds: 4 })).toThrow("CONTACT_SEARCH_CONFIG_INVALID");
  });
});

describe("Lead contact enrichment deterministic first round", () => {
  it("uses the exact company name and only standard structured region facts", () => {
    expect(buildInitialContactQuery({
      companyName: "山东高价值齿轮有限公司",
      profile: { province: "山东省", city: "济宁市" },
    })).toBe("山东高价值齿轮有限公司 山东省 济宁市 电话 邮箱 联系方式 官网");
    expect(buildInitialContactQuery({
      companyName: "山东高价值齿轮有限公司",
      profile: { province: "山东", city: "济宁" },
    })).toBe("山东高价值齿轮有限公司 电话 邮箱 联系方式 官网");
    expect(normalizeStructuredRegion({ province: "山东省", city: "广州市" }))
      .toEqual({ province: null, city: null });
    expect(normalizeStructuredRegion({ province: "国外", city: "纽约市" }))
      .toEqual({ province: null, city: null });
  });
});

describe("Lead contact candidate extraction", () => {
  it("extracts phone and email evidence in code before any verifier call", () => {
    const actual = extractContactCandidates([
      {
        title: "山东高价值齿轮有限公司 - 联系我们",
        url: "https://gear.example.com/contact",
        content: "销售电话：+86 537-1234567；手机：138-0000-0000；邮箱：sales@gear.example.com",
      },
      {
        title: "海外业务",
        url: "https://gear.example.com/global",
        snippet: "International: +1 555-123-4567, Email sales@gear.example.com",
      },
    ]);

    expect(actual.candidatePhones.map((candidate) => candidate.value)).toEqual([
      "+86 537-1234567",
      "138-0000-0000",
      "+1 555-123-4567",
    ]);
    expect(actual.candidateEmails.map((candidate) => candidate.value)).toEqual(["sales@gear.example.com"]);
    expect(actual.candidatePhones[0]).toMatchObject({
      resultTitle: "山东高价值齿轮有限公司 - 联系我们",
      resultUrl: "https://gear.example.com/contact",
    });
  });
});

describe("AI contact query planner contract", () => {
  it("accepts one strict non-repeated query and rejects invalid planner output", () => {
    expect(parseQueryPlannerOutput(JSON.stringify({
      query: "山东高价值齿轮有限公司 联系我们 电话 官网",
      strategy: "OFFICIAL_CONTACT",
    }), ["山东高价值齿轮有限公司 电话 邮箱 联系方式 官网"])).toEqual({
      query: "山东高价值齿轮有限公司 联系我们 电话 官网",
      strategy: "OFFICIAL_CONTACT",
    });
    expect(() => parseQueryPlannerOutput("```json\n{}\n```", [])).toThrow("CONTACT_QUERY_PLANNER_INVALID_OUTPUT");
    expect(() => parseQueryPlannerOutput(JSON.stringify({
      query: "山东高价值齿轮有限公司 电话 邮箱 联系方式 官网",
      strategy: "PHONE",
    }), [" 山东高价值齿轮有限公司   电话 邮箱 联系方式 官网 "])).toThrow("CONTACT_QUERY_REPEATED");
  });
});

describe("AI contact verifier contract", () => {
  it("accepts only evidence-backed candidates and standard structured regions", () => {
    const candidates = extractContactCandidates([{
      title: "山东高价值齿轮有限公司 - 联系我们",
      url: "https://gear.example.com/contact",
      content: "电话 0537-1234567，邮箱 sales@gear.example.com，地址山东省济宁市",
    }]);
    const verified = parseContactVerifierOutput(JSON.stringify({
      verified: true,
      companyMatched: true,
      phone: "0537-1234567",
      email: "sales@gear.example.com",
      province: "山东省",
      city: "济宁市",
      evidence: "目标企业名称与联系方式出现在同一官网联系页面",
    }), candidates);
    expect(verified).toMatchObject({ verified: true, province: "山东省", city: "济宁市" });

    expect(() => parseContactVerifierOutput(JSON.stringify({
      ...verified,
      phone: "400-000-0000",
    }), candidates)).toThrow("CONTACT_NOT_VERIFIED");

    expect(() => parseContactVerifierOutput(JSON.stringify({
      ...verified,
      province: "山东省",
      city: "广州市",
    }), candidates)).toThrow("CONTACT_NOT_VERIFIED");

    const platformCandidates = extractContactCandidates([{
      title: "百度平台客服电话",
      url: "https://www.baidu.com/support",
      content: "平台客服热线 400-123-4567",
    }]);
    expect(() => parseContactVerifierOutput(JSON.stringify({
      verified: true,
      companyMatched: true,
      phone: "400-123-4567",
      email: null,
      province: null,
      city: null,
      evidence: "平台客服电话",
    }), platformCandidates)).toThrow("CONTACT_NOT_VERIFIED");
  });
});

describe("AI contact verifier v1.1 disposition contract", () => {
  it("classifies evidence-backed target-company contact as DIRECT_CONTACT", () => {
    const searchResults = [{
      title: "目标齿轮有限公司 - 联系我们",
      url: "https://target.example.com/contact",
      snippet: "目标齿轮有限公司联系电话 0537-1234567",
    }];
    const candidates = extractContactCandidates(searchResults);
    const actual = parseContactVerifierV11Output(JSON.stringify({
      classification: "DIRECT_CONTACT",
      matchedCompanyName: "目标齿轮有限公司",
      relationshipType: "TARGET",
      opportunityType: null,
      phone: "0537-1234567",
      email: null,
      province: null,
      city: null,
      evidenceUrl: "https://target.example.com/contact",
      contactEvidence: "企业名称与电话位于同一官网联系页面",
      opportunityEvidence: null,
    }), {
      targetCompanyName: "目标齿轮有限公司",
      candidates,
      searchResults,
    });

    expect(actual).toMatchObject({
      classification: "DIRECT_CONTACT",
      matchedCompanyName: "目标齿轮有限公司",
      phone: "0537-1234567",
      opportunityType: null,
    });
  });

  it("rejects DIRECT_CONTACT when the evidence page names another company", () => {
    const searchResults = [{
      title: "华兴机械厂 - 联系我们",
      url: "https://other.example.com/contact",
      snippet: "目标齿轮有限公司获得行业奖项而华兴机械厂联系电话 0537-7444444。",
    }];
    const candidates = extractContactCandidates(searchResults);
    expect(() => parseContactVerifierV11Output(JSON.stringify({
      classification: "DIRECT_CONTACT",
      matchedCompanyName: "目标齿轮有限公司",
      relationshipType: "TARGET",
      opportunityType: null,
      phone: "0537-7444444",
      email: null,
      province: null,
      city: null,
      evidenceUrl: "https://other.example.com/contact",
      contactEvidence: "模型声称属于目标企业",
      opportunityEvidence: null,
    }), { targetCompanyName: "目标齿轮有限公司", candidates, searchResults }))
      .toThrow("CONTACT_NOT_VERIFIED");
  });

  it("rejects a target-company contact value that the evidence marks as obsolete", () => {
    const searchResults = [{
      title: "目标齿轮有限公司联系方式变更",
      url: "https://target.example.com/obsolete-contact",
      snippet: "目标齿轮有限公司电话 0537-7777777；该号码已停用。",
    }];
    const candidates = extractContactCandidates(searchResults);
    expect(() => parseContactVerifierV11Output(JSON.stringify({
      classification: "DIRECT_CONTACT",
      matchedCompanyName: "目标齿轮有限公司",
      relationshipType: "TARGET",
      opportunityType: null,
      phone: "0537-7777777",
      email: null,
      province: null,
      city: null,
      evidenceUrl: "https://target.example.com/obsolete-contact",
      contactEvidence: "页面包含目标企业和旧电话",
      opportunityEvidence: null,
    }), { targetCompanyName: "目标齿轮有限公司", candidates, searchResults }))
      .toThrow("CONTACT_NOT_VERIFIED");
  });

  it("rejects DIRECT_CONTACT without an explicit contact field label", () => {
    const searchResults = [{
      title: "目标齿轮有限公司",
      url: "https://target.example.com/unlabelled-contact",
      snippet: "目标齿轮有限公司0537-7888888。",
    }];
    const candidates = extractContactCandidates(searchResults);
    expect(() => parseContactVerifierV11Output(JSON.stringify({
      classification: "DIRECT_CONTACT",
      matchedCompanyName: "目标齿轮有限公司",
      relationshipType: "TARGET",
      opportunityType: null,
      phone: "0537-7888888",
      email: null,
      province: null,
      city: null,
      evidenceUrl: "https://target.example.com/unlabelled-contact",
      contactEvidence: "企业名后直接出现号码",
      opportunityEvidence: null,
    }), { targetCompanyName: "目标齿轮有限公司", candidates, searchResults }))
      .toThrow("CONTACT_NOT_VERIFIED");
  });

  it("rejects a question about a target-company contact as unverified", () => {
    const searchResults = [{
      title: "目标齿轮有限公司联系方式",
      url: "https://target.example.com/question-contact",
      snippet: "目标齿轮有限公司电话 0537-7999999？",
    }];
    const candidates = extractContactCandidates(searchResults);
    expect(() => parseContactVerifierV11Output(JSON.stringify({
      classification: "DIRECT_CONTACT",
      matchedCompanyName: "目标齿轮有限公司",
      relationshipType: "TARGET",
      opportunityType: null,
      phone: "0537-7999999",
      email: null,
      province: null,
      city: null,
      evidenceUrl: "https://target.example.com/question-contact",
      contactEvidence: "疑问句包含企业名和电话",
      opportunityEvidence: null,
    }), { targetCompanyName: "目标齿轮有限公司", candidates, searchResults }))
      .toThrow("CONTACT_NOT_VERIFIED");
  });

  it("accepts phone and email bound to the target in one complete contact sentence", () => {
    const searchResults = [{
      title: "目标齿轮有限公司联系方式",
      url: "https://target.example.com/dual-contact",
      snippet: "目标齿轮有限公司电话 0537-7112233 邮箱 sales@example.com。",
    }];
    const candidates = extractContactCandidates(searchResults);
    const actual = parseContactVerifierV11Output(JSON.stringify({
      classification: "DIRECT_CONTACT",
      matchedCompanyName: "目标齿轮有限公司",
      relationshipType: "TARGET",
      opportunityType: null,
      phone: "0537-7112233",
      email: "sales@example.com",
      province: null,
      city: null,
      evidenceUrl: "https://target.example.com/dual-contact",
      contactEvidence: "企业全称、电话和邮箱位于同一完整联系句",
      opportunityEvidence: null,
    }), { targetCompanyName: "目标齿轮有限公司", candidates, searchResults });

    expect(actual).toMatchObject({
      classification: "DIRECT_CONTACT",
      phone: "0537-7112233",
      email: "sales@example.com",
    });
  });

  it("rejects phone and email values bound to swapped contact labels", () => {
    const searchResults = [{
      title: "目标齿轮有限公司联系方式",
      url: "https://target.example.com/swapped-labels",
      snippet: "目标齿轮有限公司邮箱 0537-7112233 电话 sales@example.com。",
    }];
    const candidates = extractContactCandidates(searchResults);
    expect(() => parseContactVerifierV11Output(JSON.stringify({
      classification: "DIRECT_CONTACT",
      matchedCompanyName: "目标齿轮有限公司",
      relationshipType: "TARGET",
      opportunityType: null,
      phone: "0537-7112233",
      email: "sales@example.com",
      province: null,
      city: null,
      evidenceUrl: "https://target.example.com/swapped-labels",
      contactEvidence: "标签和值类型互换",
      opportunityEvidence: null,
    }), { targetCompanyName: "目标齿轮有限公司", candidates, searchResults }))
      .toThrow("CONTACT_NOT_VERIFIED");
  });

  it("classifies a separately named company with explicit machine-tool value as RELATED_OPPORTUNITY", () => {
    const searchResults = [{
      title: "济宁新锐机械有限公司扩产项目",
      url: "https://related.example.com/expansion",
      snippet: "济宁新锐机械有限公司为目标齿轮有限公司经销商；济宁新锐机械有限公司正在采购齿轮机床并建设数控加工车间；济宁新锐机械有限公司联系电话 0537-7654321。",
    }];
    const candidates = extractContactCandidates(searchResults);
    const actual = parseContactVerifierV11Output(JSON.stringify({
      classification: "RELATED_OPPORTUNITY",
      matchedCompanyName: "济宁新锐机械有限公司",
      relationshipType: "DEALER",
      opportunityType: "EQUIPMENT_PURCHASE",
      phone: "0537-7654321",
      email: null,
      province: "山东省",
      city: "济宁市",
      evidenceUrl: "https://related.example.com/expansion",
      contactEvidence: "企业名称与电话位于同一项目页面",
      opportunityEvidence: "济宁新锐机械有限公司正在采购齿轮机床并建设数控加工车间",
    }), {
      targetCompanyName: "目标齿轮有限公司",
      candidates,
      searchResults,
    });

    expect(actual).toMatchObject({
      classification: "RELATED_OPPORTUNITY",
      matchedCompanyName: "济宁新锐机械有限公司",
      relationshipType: "DEALER",
      opportunityType: "EQUIPMENT_PURCHASE",
      phone: "0537-7654321",
    });
  });

  it("accepts phone and email bound to a related opportunity in one complete contact sentence", () => {
    const searchResults = [{
      title: "济宁新锐机械有限公司采购计划",
      url: "https://related.example.com/dual-contact",
      snippet: "济宁新锐机械有限公司为目标齿轮有限公司经销商；济宁新锐机械有限公司正在采购机床；济宁新锐机械有限公司电话 0537-7223344 邮箱 sales@related.example.com。",
    }];
    const candidates = extractContactCandidates(searchResults);
    const actual = parseContactVerifierV11Output(JSON.stringify({
      classification: "RELATED_OPPORTUNITY",
      matchedCompanyName: "济宁新锐机械有限公司",
      relationshipType: "DEALER",
      opportunityType: "EQUIPMENT_PURCHASE",
      phone: "0537-7223344",
      email: "sales@related.example.com",
      province: null,
      city: null,
      evidenceUrl: "https://related.example.com/dual-contact",
      contactEvidence: "关联企业全称、电话和邮箱位于同一完整联系句",
      opportunityEvidence: "济宁新锐机械有限公司正在采购机床",
    }), { targetCompanyName: "目标齿轮有限公司", candidates, searchResults });

    expect(actual).toMatchObject({
      classification: "RELATED_OPPORTUNITY",
      phone: "0537-7223344",
      email: "sales@related.example.com",
    });
  });

  it("rejects a negated relationship claim even when the positive phrase is present", () => {
    const searchResults = [{
      title: "济宁新锐机械有限公司扩产澄清",
      url: "https://related.example.com/denied-dealer",
      snippet: "济宁新锐机械有限公司为目标齿轮有限公司经销商；以上说法不实；济宁新锐机械有限公司正在采购机床；济宁新锐机械有限公司电话 0537-7555555。",
    }];
    const candidates = extractContactCandidates(searchResults);
    const actual = parseContactVerifierV11Output(JSON.stringify({
      classification: "RELATED_OPPORTUNITY",
      matchedCompanyName: "济宁新锐机械有限公司",
      relationshipType: "DEALER",
      opportunityType: "EQUIPMENT_PURCHASE",
      phone: "0537-7555555",
      email: null,
      province: null,
      city: null,
      evidenceUrl: "https://related.example.com/denied-dealer",
      contactEvidence: "企业名称与电话同页",
      opportunityEvidence: "济宁新锐机械有限公司正在采购机床",
    }), { targetCompanyName: "目标齿轮有限公司", candidates, searchResults });

    expect(actual).toMatchObject({
      classification: "REJECT",
      rejectionReason: "RELATED_OPPORTUNITY_NOT_SUPPORTED",
    });
  });

  it("rejects machine-tool opportunity evidence that belongs to a third company", () => {
    const searchResults = [{
      title: "济宁新锐机械有限公司合作动态",
      url: "https://related.example.com/third-party-purchase",
      snippet: "济宁新锐机械有限公司是目标齿轮有限公司经销商；济宁新锐机械有限公司正在采购数控机床，实际是华南设备采购；济宁新锐机械有限公司电话 0537-7666666。",
    }];
    const candidates = extractContactCandidates(searchResults);
    const actual = parseContactVerifierV11Output(JSON.stringify({
      classification: "RELATED_OPPORTUNITY",
      matchedCompanyName: "济宁新锐机械有限公司",
      relationshipType: "DEALER",
      opportunityType: "EQUIPMENT_PURCHASE",
      phone: "0537-7666666",
      email: null,
      province: null,
      city: null,
      evidenceUrl: "https://related.example.com/third-party-purchase",
      contactEvidence: "企业名称与电话同页",
      opportunityEvidence: "济宁新锐机械有限公司正在采购数控机床",
    }), { targetCompanyName: "目标齿轮有限公司", candidates, searchResults });

    expect(actual).toMatchObject({
      classification: "REJECT",
      rejectionReason: "RELATED_OPPORTUNITY_NOT_SUPPORTED",
    });
  });

  it("downgrades a dealer-only relationship without machine-tool opportunity evidence to REJECT", () => {
    const searchResults = [{
      title: "某某贸易有限公司",
      url: "https://dealer.example.com/profile",
      snippet: "某某贸易有限公司是目标企业授权经销商，联系电话 0537-7000000。",
    }];
    const candidates = extractContactCandidates(searchResults);
    const actual = parseContactVerifierV11Output(JSON.stringify({
      classification: "RELATED_OPPORTUNITY",
      matchedCompanyName: "某某贸易有限公司",
      relationshipType: "DEALER",
      opportunityType: "MANUFACTURING_CAPABILITY",
      phone: "0537-7000000",
      email: null,
      province: null,
      city: null,
      evidenceUrl: "https://dealer.example.com/profile",
      contactEvidence: "企业名称和电话位于同一经销商页面",
      opportunityEvidence: "目标企业授权经销商",
    }), {
      targetCompanyName: "目标齿轮有限公司",
      candidates,
      searchResults,
    });

    expect(actual).toMatchObject({
      classification: "REJECT",
      rejectionReason: "RELATED_OPPORTUNITY_NOT_SUPPORTED",
      phone: null,
      email: null,
    });
  });

  it("rejects a news author contact even when the article contains a valid expansion signal", () => {
    const searchResults = [{
      title: "济宁新锐机械有限公司扩产新闻",
      url: "https://news.example.com/related-expansion",
      snippet: "济宁新锐机械有限公司扩建数控加工车间并采购机床。记者张三，联系电话 13800000000。",
    }];
    const candidates = extractContactCandidates(searchResults);
    const actual = parseContactVerifierV11Output(JSON.stringify({
      classification: "RELATED_OPPORTUNITY",
      matchedCompanyName: "济宁新锐机械有限公司",
      relationshipType: "RELATED_COMPANY",
      opportunityType: "CAPACITY_EXPANSION",
      phone: "13800000000",
      email: null,
      province: null,
      city: null,
      evidenceUrl: "https://news.example.com/related-expansion",
      contactEvidence: "文章中出现电话号码",
      opportunityEvidence: "扩建数控加工车间",
    }), {
      targetCompanyName: "目标齿轮有限公司",
      candidates,
      searchResults,
    });

    expect(actual).toMatchObject({
      classification: "REJECT",
      rejectionReason: "UNSAFE_CONTACT_SOURCE",
      phone: null,
    });
  });

  it("safely rejects RELATED_OPPORTUNITY without a concrete related company name", () => {
    const searchResults = [{
      title: "扩产项目",
      url: "https://related.example.com/unnamed",
      snippet: "某企业扩建加工车间并采购机床，电话 0537-7111111。",
    }];
    const candidates = extractContactCandidates(searchResults);
    const actual = parseContactVerifierV11Output(JSON.stringify({
      classification: "RELATED_OPPORTUNITY",
      matchedCompanyName: null,
      relationshipType: "RELATED_COMPANY",
      opportunityType: "CAPACITY_EXPANSION",
      phone: "0537-7111111",
      email: null,
      province: null,
      city: null,
      evidenceUrl: "https://related.example.com/unnamed",
      contactEvidence: "页面包含电话",
      opportunityEvidence: "扩建加工车间",
    }), { targetCompanyName: "目标齿轮有限公司", candidates, searchResults });

    expect(actual).toMatchObject({
      classification: "REJECT",
      rejectionReason: "RELATED_OPPORTUNITY_NOT_SUPPORTED",
    });
  });

  it("rejects a machine-tool prospect with no evidenced relationship to the target company", () => {
    const searchResults = [{
      title: "独立机械有限公司扩产项目",
      url: "https://unrelated.example.com/expansion",
      snippet: "独立机械有限公司扩建加工车间并采购数控机床，电话 0537-7222222。",
    }];
    const candidates = extractContactCandidates(searchResults);
    const actual = parseContactVerifierV11Output(JSON.stringify({
      classification: "RELATED_OPPORTUNITY",
      matchedCompanyName: "独立机械有限公司",
      relationshipType: "RELATED_COMPANY",
      opportunityType: "CAPACITY_EXPANSION",
      phone: "0537-7222222",
      email: null,
      province: null,
      city: null,
      evidenceUrl: "https://unrelated.example.com/expansion",
      contactEvidence: "企业名称与电话同页",
      opportunityEvidence: "扩建加工车间",
    }), { targetCompanyName: "目标齿轮有限公司", candidates, searchResults });

    expect(actual).toMatchObject({
      classification: "REJECT",
      rejectionReason: "RELATED_OPPORTUNITY_NOT_SUPPORTED",
    });
  });

  it("rejects a relationship claim that points to another company instead of the target", () => {
    const searchResults = [{
      title: "独立机械有限公司扩产项目",
      url: "https://unrelated.example.com/third-party-dealer",
      snippet: "目标齿轮有限公司获得行业奖项而独立机械有限公司是华南设备有限公司授权经销商并正在扩建加工车间采购数控机床，电话 0537-7333333。",
    }];
    const candidates = extractContactCandidates(searchResults);
    const actual = parseContactVerifierV11Output(JSON.stringify({
      classification: "RELATED_OPPORTUNITY",
      matchedCompanyName: "独立机械有限公司",
      relationshipType: "DEALER",
      opportunityType: "EQUIPMENT_PURCHASE",
      phone: "0537-7333333",
      email: null,
      province: null,
      city: null,
      evidenceUrl: "https://unrelated.example.com/third-party-dealer",
      contactEvidence: "企业名称与电话同页",
      opportunityEvidence: "采购数控机床",
    }), { targetCompanyName: "目标齿轮有限公司", candidates, searchResults });

    expect(actual).toMatchObject({
      classification: "REJECT",
      rejectionReason: "RELATED_OPPORTUNITY_NOT_SUPPORTED",
    });
  });
});

describe("related opportunity Lead derivation", () => {
  it("locks the verified company/contact and requires the existing AI score gate", () => {
    const disposition = {
      classification: "RELATED_OPPORTUNITY",
      matchedCompanyName: "济宁新锐机械有限公司",
      relationshipType: "DEALER",
      opportunityType: "EQUIPMENT_PURCHASE",
      phone: "0537-7654321",
      email: null,
      province: "山东省",
      city: "济宁市",
      evidenceUrl: "https://related.example.com/expansion",
      contactEvidence: "企业名称与电话位于同一项目页面",
      opportunityEvidence: "正在建设数控加工车间并采购齿轮机床",
    };
    const actual = buildScoredRelatedLead({
      targetLead: { companyName: "目标齿轮有限公司", aiScore: 95, profile: { industry: "齿轮制造" } },
      disposition,
      scoredLead: {
        companyName: "模型不得覆盖的名称",
        aiScore: 88,
        phone: "400-000-0000",
        profile: { industry: "机械加工", confidence: "high" },
      },
      contactSearchQuery: "目标齿轮有限公司 联系方式",
    });

    expect(actual).toMatchObject({
      shouldWrite: true,
      contactSearchAllowed: false,
      validatedLead: {
        companyName: "济宁新锐机械有限公司",
        phone: "0537-7654321",
        aiScore: 88,
        sourceUrl: "https://related.example.com/expansion",
        profile: {
          leadOrigin: "RELATED_OPPORTUNITY",
          relatedToCompanyName: "目标齿轮有限公司",
          relationshipType: "DEALER",
          opportunityType: "EQUIPMENT_PURCHASE",
          province: "山东省",
          city: "济宁市",
        },
      },
    });
  });
});

describe("Lead contact enrichment orchestration", () => {
  it("performs zero enrichment calls when an eligible Lead already has a valid contact", async () => {
    let calls = 0;
    const unexpected = async () => {
      calls += 1;
      throw new Error("Enrichment must not run");
    };
    const result = await runContactEnrichment({
      validatedLead: { companyName: "已有联系方式企业", aiScore: 95, phone: "13800000000", email: "invalid-email" },
      search: unexpected,
      planQuery: unexpected,
      verify: unexpected,
    });
    expect(calls).toBe(0);
    expect(result).toMatchObject({ shouldWrite: true, contactSearchRound: 0, status: "CONTACT_SEARCH_NOT_REQUIRED" });
    expect(result.validatedLead).not.toHaveProperty("email");
  });

  it("preserves a valid 2048-character evidence URL and rejects 2049 before verification", async () => {
    const sourceUrl = `https://example.com/${"a".repeat(2_048 - "https://example.com/".length)}`;
    let verifierInput;
    const run = (url) => runContactEnrichment({
      validatedLead: { companyName: "长链接证据企业", aiScore: 95, profile: {} },
      search: async () => [{ title: "长链接证据企业", url, content: "电话 0510-12345678" }],
      planQuery: async () => {
        throw new Error("Round 2 must not run");
      },
      verify: async (input) => {
        verifierInput = input;
        return JSON.stringify({
          verified: true,
          companyMatched: true,
          phone: "0510-12345678",
          email: null,
          province: null,
          city: null,
          evidence: "企业名称和电话位于同一页面",
        });
      },
    });

    await run(sourceUrl);
    expect(verifierInput.searchResults[0].url).toBe(sourceUrl);
    await expect(run(`${sourceUrl}x`)).rejects.toThrow(/INVALID_ARGUMENT.*sourceUrl.*2048/iu);
  });

  it("stops after a verified Round 1 result and backfills trusted location facts", async () => {
    let searchCalls = 0;
    let plannerCalls = 0;
    let verifierCalls = 0;
    const result = await runContactEnrichment({
      validatedLead: {
        companyName: "山东高价值齿轮有限公司",
        aiScore: 95,
        profile: { industry: "齿轮制造" },
      },
      search: async () => {
        searchCalls += 1;
        return [{
          title: "山东高价值齿轮有限公司 - 联系我们",
          url: "https://gear.example.com/contact",
          content: "电话 0537-1234567，地址山东省济宁市",
        }];
      },
      planQuery: async () => {
        plannerCalls += 1;
        throw new Error("Round 2 must not run");
      },
      verify: async () => {
        verifierCalls += 1;
        return JSON.stringify({
          verified: true,
          companyMatched: true,
          phone: "0537-1234567",
          email: null,
          province: "山东省",
          city: "济宁市",
          evidence: "企业名称、电话和地址位于同一官网联系页",
        });
      },
    });

    expect({ searchCalls, plannerCalls, verifierCalls }).toEqual({ searchCalls: 1, plannerCalls: 0, verifierCalls: 1 });
    expect(result).toMatchObject({
      shouldWrite: true,
      contactSearchRound: 1,
      status: "CONTACT_SEARCH_VERIFIED",
      validatedLead: {
        phone: "0537-1234567",
        profile: { industry: "齿轮制造", province: "山东省", city: "济宁市" },
      },
    });
  });

  it("uses one adaptive planner query and stops after a verified Round 2 result", async () => {
    let searchCalls = 0;
    let plannerCalls = 0;
    let plannerInput;
    const result = await runContactEnrichment({
      validatedLead: { companyName: "华东精密传动有限公司", aiScore: 96, profile: { industry: "传动设备" } },
      search: async ({ contactSearchRound }) => {
        searchCalls += 1;
        return contactSearchRound === 1 ? [{
          title: "华东精密传动有限公司企业介绍",
          url: "https://transmission.example.com/about",
          snippet: "专业传动设备制造企业，暂未列出联系方式",
        }] : [{
          title: "华东精密传动有限公司联系方式",
          url: "https://transmission.example.com/about/contact",
          snippet: "商务邮箱 export@transmission.example.com",
        }];
      },
      planQuery: async (input) => {
        plannerCalls += 1;
        plannerInput = input;
        return JSON.stringify({ query: "华东精密传动有限公司 商务邮箱 联系我们", strategy: "EMAIL" });
      },
      verify: async () => JSON.stringify({
        verified: true,
        companyMatched: true,
        phone: null,
        email: "export@transmission.example.com",
        province: null,
        city: null,
        evidence: "企业名称和商务邮箱位于同一官网页面",
      }),
    });

    expect({ searchCalls, plannerCalls }).toEqual({ searchCalls: 2, plannerCalls: 1 });
    expect(plannerInput.excludedResults[0]).toMatchObject({
      title: "华东精密传动有限公司企业介绍",
      url: "https://transmission.example.com/about",
      domain: "transmission.example.com",
      snippet: "专业传动设备制造企业，暂未列出联系方式",
    });
    expect(result).toMatchObject({
      shouldWrite: true,
      contactSearchRound: 2,
      status: "CONTACT_SEARCH_VERIFIED",
      validatedLead: { email: "export@transmission.example.com" },
    });
  });

  it("never exceeds three Baidu calls and returns exhaustion without throwing", async () => {
    let searchCalls = 0;
    let plannerCalls = 0;
    const result = await runContactEnrichment({
      validatedLead: { companyName: "无公开联系方式企业", aiScore: 99, profile: {} },
      search: async () => {
        searchCalls += 1;
        return [];
      },
      planQuery: async ({ contactSearchRound }) => {
        plannerCalls += 1;
        return JSON.stringify({
          query: `无公开联系方式企业 第${contactSearchRound}轮 联系方式`,
          strategy: contactSearchRound === 2 ? "PHONE" : "BUSINESS_DIRECTORY",
        });
      },
      verify: async () => {
        throw new Error("Verifier must not run without candidates");
      },
    });

    expect({ searchCalls, plannerCalls }).toEqual({ searchCalls: 3, plannerCalls: 2 });
    expect(result).toMatchObject({
      shouldWrite: false,
      contactSearchRound: 3,
      status: "CONTACT_ENRICHMENT_EXHAUSTED",
      lastFailureStatus: "CONTACT_NOT_FOUND",
    });
  });

  it("treats Baidu API errors as per-Lead failures and still respects the three-call cap", async () => {
    let searchCalls = 0;
    const result = await runContactEnrichment({
      validatedLead: { companyName: "搜索接口异常企业", aiScore: 98, profile: {} },
      search: async () => {
        searchCalls += 1;
        throw new Error("upstream unavailable");
      },
      planQuery: async ({ contactSearchRound }) => JSON.stringify({
        query: `搜索接口异常企业 联系方式 第${contactSearchRound}轮`,
        strategy: "BUSINESS_DIRECTORY",
      }),
      verify: async () => {
        throw new Error("Verifier must not run");
      },
    });
    expect(searchCalls).toBe(3);
    expect(result).toMatchObject({
      status: "CONTACT_ENRICHMENT_EXHAUSTED",
      lastFailureStatus: "CONTACT_SEARCH_API_ERROR",
      shouldWrite: false,
    });
  });

  it("fails only the current Lead when the Round 2 planner returns invalid JSON", async () => {
    let searchCalls = 0;
    const result = await runContactEnrichment({
      validatedLead: { companyName: "Planner 异常企业", aiScore: 97, profile: {} },
      search: async () => {
        searchCalls += 1;
        return [];
      },
      planQuery: async () => "not-json",
      verify: async () => {
        throw new Error("Verifier must not run");
      },
    });
    expect(searchCalls).toBe(1);
    expect(result).toMatchObject({
      contactSearchRound: 2,
      status: "CONTACT_QUERY_PLANNER_INVALID_OUTPUT",
      shouldWrite: false,
    });
  });

  it("rejects a candidate that the verifier cannot attribute to the target company", async () => {
    let verifierCalls = 0;
    const result = await runContactEnrichment({
      validatedLead: { companyName: "目标齿轮企业", aiScore: 99, profile: { province: "山东省", city: "济宁市" } },
      search: async ({ contactSearchRound }) => [{
        title: `同名其他企业结果 ${contactSearchRound}`,
        url: `https://directory.example.com/result/${contactSearchRound}`,
        content: "电话 0537-7654321",
      }],
      planQuery: async ({ contactSearchRound }) => JSON.stringify({
        query: `目标齿轮企业 山东省 济宁市 联系方式 ${contactSearchRound}`,
        strategy: "REGION_DISAMBIGUATION",
      }),
      verify: async () => {
        verifierCalls += 1;
        return JSON.stringify({
          verified: false,
          companyMatched: false,
          phone: null,
          email: null,
          province: null,
          city: null,
          evidence: "搜索结果属于同名但不同地区企业",
        });
      },
    });
    expect(verifierCalls).toBe(3);
    expect(result).toMatchObject({
      status: "CONTACT_ENRICHMENT_EXHAUSTED",
      lastFailureStatus: "CONTACT_NOT_VERIFIED",
      shouldWrite: false,
    });
  });
});
