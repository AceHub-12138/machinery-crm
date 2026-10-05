import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildContactEnrichmentWorkflow,
  buildRelatedOpportunityWorkflow,
} from "./build-lead-contact-enrichment-workflow.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(`${root}${path}`, "utf8"));
const readText = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/gu, "\n");

describe("Lead contact enrichment v1.1 related opportunity workflow", () => {
  it("preserves v1 while adding one bounded derived-Lead path per contact-search round", () => {
    const n4 = readJson("n8n/workflows/baidu-lead-e2e-n4-pass.json");
    const v1 = readJson("n8n/workflows/baidu-lead-contact-enrichment-v1.json");
    const v11 = readJson("n8n/workflows/baidu-lead-contact-enrichment-v1.1.json");
    const generated = buildRelatedOpportunityWorkflow(buildContactEnrichmentWorkflow(n4));
    const names = v11.nodes.map((node) => node.name);
    const withoutEmbeddedCode = (workflow) => ({
      ...workflow,
      nodes: workflow.nodes.map((node) => node.type === "n8n-nodes-base.code"
        ? { ...node, parameters: { ...node.parameters, jsCode: "<validated separately>" } }
        : node),
    });

    expect(withoutEmbeddedCode(buildContactEnrichmentWorkflow(n4))).toEqual(withoutEmbeddedCode(v1));
    expect(withoutEmbeddedCode(generated)).toEqual(withoutEmbeddedCode(v11));
    expect(generated.name).toBe("百度获客-联系方式反查-v1.1-关联潜客");
    expect(generated.active).toBe(false);
    expect(names.filter((name) => /^Baidu Contact Search R[123]$/.test(name))).toHaveLength(3);
    expect(names.filter((name) => /^AI Score Related Opportunity R[123]$/.test(name))).toHaveLength(3);
    expect(names.filter((name) => /^Related Lead MCP Upsert R[123]$/.test(name))).toHaveLength(3);
    expect(names.filter((name) => /^Related Validate Lead MCP Result R[123]$/.test(name))).toHaveLength(3);
    expect(names.filter((name) => /^Resume Original Lead R[123]$/.test(name))).toHaveLength(3);
    for (const round of [1, 2, 3]) {
      expect(v11.connections[`Contact Verified R${round}?`].main[1][0].node).toBe(`Related Opportunity R${round}?`);
      expect(v11.connections[`Related Opportunity R${round}?`].main[0][0].node).toBe(`AI Score Related Opportunity R${round}`);
      expect(v11.connections[`Related Lead MCP Upsert R${round}`].main[0][0].node).toBe(`Related Validate Lead MCP Result R${round}`);
      expect(v11.connections[`Related Validate Lead MCP Result R${round}`].main[0][0].node).toBe(`Resume Original Lead R${round}`);
    }
    expect(JSON.stringify(v11)).toContain("DIRECT_CONTACT");
    expect(JSON.stringify(v11)).toContain("RELATED_OPPORTUNITY");
    expect(JSON.stringify(v11)).toContain("REJECT");
    expect(JSON.stringify(v11)).toContain("RELATED_OPPORTUNITY_ALREADY_PROCESSED");
    expect(JSON.stringify(v11)).toContain("derivedEvidenceUrls");
    expect(JSON.stringify(v11)).not.toContain("contact-derived-idempotency-round");
    const contract = readText("docs/mcp/LEAD_CONTACT_ENRICHMENT_V1_1.md");
    expect(contract).toContain("$.result.isError !== true");
    expect(contract).toContain("$.result.structuredContent.ok === true");
    expect(contract).toContain("typeof $.result.structuredContent.data.items[0].id === \"string\"");
  });

  it("executes DIRECT_CONTACT, RELATED_OPPORTUNITY and REJECT without cross-company contact pollution", () => {
    const workflow = readJson("n8n/workflows/baidu-lead-contact-enrichment-v1.1.json");
    const code = workflow.nodes.find((node) => node.name === "Apply Contact Verification R1").parameters.jsCode;
    const execute = new Function("$input", "$json", "$", code);
    const run = (state, verifierOutput) => execute(
      { all: () => [] },
      { choices: [{ message: { content: JSON.stringify(verifierOutput) } }] },
      () => ({ item: { json: state } }),
    ).json;
    const originalLead = { companyName: "目标齿轮有限公司", aiScore: 95, profile: { industry: "齿轮制造" } };
    const directState = {
      validatedLead: originalLead,
      contactSearchQuery: "目标齿轮有限公司 联系方式",
      searchResults: [{ title: "目标齿轮有限公司", url: "https://target.example.com/contact", snippet: "目标齿轮有限公司电话 0537-1234567" }],
      candidatePhones: [{ value: "0537-1234567", resultTitle: "目标齿轮有限公司", resultUrl: "https://target.example.com/contact", resultContent: "目标齿轮有限公司电话 0537-1234567" }],
      candidateEmails: [],
    };
    const direct = run(directState, {
      classification: "DIRECT_CONTACT",
      matchedCompanyName: "目标齿轮有限公司",
      relationshipType: "TARGET",
      opportunityType: null,
      phone: "0537-1234567",
      email: null,
      province: null,
      city: null,
      evidenceUrl: "https://target.example.com/contact",
      contactEvidence: "目标企业名称和电话同页",
      opportunityEvidence: null,
    });
    expect(direct).toMatchObject({ directContact: true, relatedOpportunity: false, validatedLead: { companyName: "目标齿轮有限公司", phone: "0537-1234567" } });

    const dualContactState = {
      ...directState,
      searchResults: [{ title: "目标齿轮有限公司联系方式", url: "https://target.example.com/dual-contact", snippet: "目标齿轮有限公司电话 0537-7112233 邮箱 sales@example.com" }],
      candidatePhones: [{ value: "0537-7112233", resultTitle: "目标齿轮有限公司联系方式", resultUrl: "https://target.example.com/dual-contact", resultContent: "目标齿轮有限公司电话 0537-7112233 邮箱 sales@example.com" }],
      candidateEmails: [{ value: "sales@example.com", resultTitle: "目标齿轮有限公司联系方式", resultUrl: "https://target.example.com/dual-contact", resultContent: "目标齿轮有限公司电话 0537-7112233 邮箱 sales@example.com" }],
    };
    const dualContact = run(dualContactState, {
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
    });
    expect(dualContact).toMatchObject({ directContact: true, validatedLead: { phone: "0537-7112233", email: "sales@example.com" } });

    const swappedLabelsState = {
      ...dualContactState,
      searchResults: [{ title: "目标齿轮有限公司联系方式", url: "https://target.example.com/swapped-labels", snippet: "目标齿轮有限公司邮箱 0537-7112233 电话 sales@example.com" }],
      candidatePhones: [{ value: "0537-7112233", resultTitle: "目标齿轮有限公司联系方式", resultUrl: "https://target.example.com/swapped-labels", resultContent: "目标齿轮有限公司邮箱 0537-7112233 电话 sales@example.com" }],
      candidateEmails: [{ value: "sales@example.com", resultTitle: "目标齿轮有限公司联系方式", resultUrl: "https://target.example.com/swapped-labels", resultContent: "目标齿轮有限公司邮箱 0537-7112233 电话 sales@example.com" }],
    };
    const swappedLabels = run(swappedLabelsState, {
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
    });
    expect(swappedLabels).toMatchObject({ classification: "REJECT", lastFailureStatus: "CONTACT_NOT_VERIFIED" });

    const otherCompanyState = {
      ...directState,
      searchResults: [{ title: "华兴机械厂", url: "https://other.example.com/contact", snippet: "目标齿轮有限公司获得行业奖项而华兴机械厂电话 0537-7444444" }],
      candidatePhones: [{ value: "0537-7444444", resultTitle: "华兴机械厂", resultUrl: "https://other.example.com/contact", resultContent: "目标齿轮有限公司获得行业奖项而华兴机械厂电话 0537-7444444" }],
    };
    const misattributedDirect = run(otherCompanyState, {
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
    });
    expect(misattributedDirect).toMatchObject({ classification: "REJECT", lastFailureStatus: "CONTACT_NOT_VERIFIED" });

    const obsoleteContactState = {
      ...directState,
      searchResults: [{ title: "目标齿轮有限公司联系方式变更", url: "https://target.example.com/obsolete-contact", snippet: "目标齿轮有限公司电话 0537-7777777；该号码已停用" }],
      candidatePhones: [{ value: "0537-7777777", resultTitle: "目标齿轮有限公司联系方式变更", resultUrl: "https://target.example.com/obsolete-contact", resultContent: "目标齿轮有限公司电话 0537-7777777；该号码已停用" }],
    };
    const obsoleteContact = run(obsoleteContactState, {
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
    });
    expect(obsoleteContact).toMatchObject({ classification: "REJECT", lastFailureStatus: "CONTACT_NOT_VERIFIED" });

    const questionedContactState = {
      ...directState,
      searchResults: [{ title: "目标齿轮有限公司联系方式", url: "https://target.example.com/question-contact", snippet: "目标齿轮有限公司电话 0537-7999999？" }],
      candidatePhones: [{ value: "0537-7999999", resultTitle: "目标齿轮有限公司联系方式", resultUrl: "https://target.example.com/question-contact", resultContent: "目标齿轮有限公司电话 0537-7999999？" }],
    };
    const questionedContact = run(questionedContactState, {
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
    });
    expect(questionedContact).toMatchObject({ classification: "REJECT", lastFailureStatus: "CONTACT_NOT_VERIFIED" });

    const relatedState = {
      ...directState,
      searchResults: [{ title: "济宁新锐机械有限公司扩产", url: "https://related.example.com/project", snippet: "济宁新锐机械有限公司是目标齿轮有限公司经销商；济宁新锐机械有限公司正在采购机床并建设加工车间；济宁新锐机械有限公司电话 0537-7654321" }],
      candidatePhones: [{ value: "0537-7654321", resultTitle: "济宁新锐机械有限公司扩产", resultUrl: "https://related.example.com/project", resultContent: "济宁新锐机械有限公司是目标齿轮有限公司经销商；济宁新锐机械有限公司正在采购机床并建设加工车间；济宁新锐机械有限公司电话 0537-7654321" }],
    };
    const related = run(relatedState, {
      classification: "RELATED_OPPORTUNITY",
      matchedCompanyName: "济宁新锐机械有限公司",
      relationshipType: "DEALER",
      opportunityType: "EQUIPMENT_PURCHASE",
      phone: "0537-7654321",
      email: null,
      province: null,
      city: null,
      evidenceUrl: "https://related.example.com/project",
      contactEvidence: "关联企业名称和电话同页",
      opportunityEvidence: "济宁新锐机械有限公司正在采购机床并建设加工车间",
    });
    expect(related).toMatchObject({
      directContact: false,
      relatedOpportunity: true,
      validatedLead: { companyName: "目标齿轮有限公司" },
      relatedOpportunityFact: { matchedCompanyName: "济宁新锐机械有限公司", phone: "0537-7654321" },
    });
    expect(related.validatedLead).not.toHaveProperty("phone");

    const questionedRelationshipState = {
      ...directState,
      searchResults: [{ title: "济宁新锐机械有限公司待核实信息", url: "https://related.example.com/questioned", snippet: "济宁新锐机械有限公司是目标齿轮有限公司经销商？；济宁新锐机械有限公司正在采购机床？；济宁新锐机械有限公司电话 0537-7654321？" }],
      candidatePhones: [{ value: "0537-7654321", resultTitle: "济宁新锐机械有限公司待核实信息", resultUrl: "https://related.example.com/questioned", resultContent: "济宁新锐机械有限公司是目标齿轮有限公司经销商？；济宁新锐机械有限公司正在采购机床？；济宁新锐机械有限公司电话 0537-7654321？" }],
    };
    const questionedRelationship = run(questionedRelationshipState, {
      classification: "RELATED_OPPORTUNITY",
      matchedCompanyName: "济宁新锐机械有限公司",
      relationshipType: "DEALER",
      opportunityType: "EQUIPMENT_PURCHASE",
      phone: "0537-7654321",
      email: null,
      province: null,
      city: null,
      evidenceUrl: "https://related.example.com/questioned",
      contactEvidence: "疑问句包含企业名和电话",
      opportunityEvidence: "济宁新锐机械有限公司正在采购机床？",
    });
    expect(questionedRelationship).toMatchObject({ classification: "REJECT", lastFailureStatus: "RELATED_OPPORTUNITY_NOT_SUPPORTED" });

    const thirdPartyRelationshipState = {
      ...directState,
      searchResults: [{ title: "独立机械有限公司扩产", url: "https://unrelated.example.com/third-party-dealer", snippet: "目标齿轮有限公司获得行业奖项而独立机械有限公司是华南设备有限公司授权经销商并正在采购机床，电话 0537-7333333" }],
      candidatePhones: [{ value: "0537-7333333", resultTitle: "独立机械有限公司扩产", resultUrl: "https://unrelated.example.com/third-party-dealer", resultContent: "目标齿轮有限公司获得行业奖项而独立机械有限公司是华南设备有限公司授权经销商并正在采购机床，电话 0537-7333333" }],
    };
    const thirdPartyRelationship = run(thirdPartyRelationshipState, {
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
      opportunityEvidence: "正在采购机床",
    });
    expect(thirdPartyRelationship).toMatchObject({ classification: "REJECT", lastFailureStatus: "RELATED_OPPORTUNITY_NOT_SUPPORTED" });

    const deniedRelationshipState = {
      ...directState,
      searchResults: [{ title: "济宁新锐机械有限公司扩产澄清", url: "https://related.example.com/denied-dealer", snippet: "济宁新锐机械有限公司为目标齿轮有限公司经销商；以上说法不实；济宁新锐机械有限公司正在采购机床；济宁新锐机械有限公司电话 0537-7555555" }],
      candidatePhones: [{ value: "0537-7555555", resultTitle: "济宁新锐机械有限公司扩产澄清", resultUrl: "https://related.example.com/denied-dealer", resultContent: "济宁新锐机械有限公司为目标齿轮有限公司经销商；以上说法不实；济宁新锐机械有限公司正在采购机床；济宁新锐机械有限公司电话 0537-7555555" }],
    };
    const deniedRelationship = run(deniedRelationshipState, {
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
    });
    expect(deniedRelationship).toMatchObject({ classification: "REJECT", lastFailureStatus: "RELATED_OPPORTUNITY_NOT_SUPPORTED" });

    const thirdPartyOpportunityState = {
      ...directState,
      searchResults: [{ title: "济宁新锐机械有限公司合作动态", url: "https://related.example.com/third-party-purchase", snippet: "济宁新锐机械有限公司是目标齿轮有限公司经销商；济宁新锐机械有限公司正在采购数控机床，实际是华南设备采购；济宁新锐机械有限公司电话 0537-7666666" }],
      candidatePhones: [{ value: "0537-7666666", resultTitle: "济宁新锐机械有限公司合作动态", resultUrl: "https://related.example.com/third-party-purchase", resultContent: "济宁新锐机械有限公司是目标齿轮有限公司经销商；济宁新锐机械有限公司正在采购数控机床，实际是华南设备采购；济宁新锐机械有限公司电话 0537-7666666" }],
    };
    const thirdPartyOpportunity = run(thirdPartyOpportunityState, {
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
    });
    expect(thirdPartyOpportunity).toMatchObject({ classification: "REJECT", lastFailureStatus: "RELATED_OPPORTUNITY_NOT_SUPPORTED" });

    const rejected = run(directState, {
      classification: "REJECT",
      matchedCompanyName: null,
      relationshipType: "PLATFORM",
      opportunityType: null,
      phone: null,
      email: null,
      province: null,
      city: null,
      evidenceUrl: null,
      contactEvidence: "平台客服电话",
      opportunityEvidence: null,
    });
    expect(rejected).toMatchObject({ classification: "REJECT", directContact: false, relatedOpportunity: false });
  });

  it("re-scores a related company, locks verified facts, and resumes the original bounded search", () => {
    const workflow = readJson("n8n/workflows/baidu-lead-contact-enrichment-v1.1.json");
    const node = (name) => workflow.nodes.find((candidate) => candidate.name === name);
    const dispositionState = {
      validatedLead: { companyName: "目标齿轮有限公司", aiScore: 95, profile: {} },
      contactSearchRound: 1,
      contactSearchMaxRounds: 3,
      previousQueries: ["目标齿轮有限公司 联系方式"],
      relatedOpportunity: true,
      relatedOpportunityFact: {
        matchedCompanyName: "济宁新锐机械有限公司",
        relationshipType: "DEALER",
        opportunityType: "EQUIPMENT_PURCHASE",
        phone: "0537-7654321",
        email: null,
        province: "山东省",
        city: "济宁市",
        evidenceUrl: "https://related.example.com/project",
        contactEvidence: "企业名称和电话同页",
        opportunityEvidence: "采购齿轮机床并扩建加工车间",
        contactSearchQuery: "目标齿轮有限公司 联系方式",
      },
    };
    const build = new Function("$input", "$json", "$", node("Build Related Lead R1").parameters.jsCode);
    const runScore = (aiScore) => build(
      { all: () => [] },
      { choices: [{ message: { content: JSON.stringify({
        companyName: "模型错误企业名",
        phone: "400-000-0000",
        aiScore,
        profile: { industry: "机械加工", confidence: "high" },
      }) } }] },
      () => ({ item: { json: dispositionState } }),
    ).json;
    const accepted = runScore(88);
    expect(accepted).toMatchObject({
      derivedEligible: true,
      contactSearchAllowed: false,
      validatedLead: {
        companyName: "济宁新锐机械有限公司",
        phone: "0537-7654321",
        aiScore: 88,
        sourceUrl: "https://related.example.com/project",
      },
    });
    expect(runScore(79)).toMatchObject({ derivedEligible: false, contactSearchAllowed: false });

    const resume = new Function("$input", "$json", "$", node("Resume Original Lead R1").parameters.jsCode);
    const resumed = resume({ all: () => [] }, { ok: true }, () => ({ item: { json: dispositionState } })).json;
    expect(resumed).toMatchObject({
      validatedLead: { companyName: "目标齿轮有限公司" },
      contactSearchRound: 1,
      contactSearchMaxRounds: 3,
      relatedOpportunity: false,
      derivedOutcomes: [{ companyName: "济宁新锐机械有限公司", contactSearchRound: 1, processed: true }],
      derivedEvidenceUrls: ["https://related.example.com/project"],
    });
    expect(resumed.validatedLead).not.toHaveProperty("phone");

    const payloadAssignments = Object.fromEntries(node("Related Lead MCP Payload R1")
      .parameters.assignments.assignments.map((assignment) => [assignment.name, assignment.value]));
    expect(payloadAssignments.sourceUrl).toBe("={{ $json.validatedLead.sourceUrl }}");
    expect(payloadAssignments.searchKeyword).toContain("Code in JavaScript");
    expect(payloadAssignments.extractorVersion).toBe("contact-related-opportunity-v1.1");
    expect(node("Related Lead Idempotency SHA256 R1").parameters.value).not.toContain("contactSearchRound");
    expect(node("Related Canonical Lead Payload R1").parameters.jsCode)
      .toBe(node("Canonical Lead Payload").parameters.jsCode);
    expect(node("Related Finalize Lead MCP Item R1").parameters.jsCode)
      .toBe(node("Finalize Lead MCP Item").parameters.jsCode);
    expect(node("Related Lead MCP Upsert R1").parameters)
      .toEqual(node("Lead MCP Upsert").parameters);
    expect(node("Related Lead MCP Upsert R1").credentials)
      .toEqual(node("Lead MCP Upsert").credentials);
  });

  it("archives the exact v1.1 classifier and derived-Lead scoring contract", () => {
    const contract = readText("docs/mcp/LEAD_CONTACT_ENRICHMENT_V1_1.md");
    expect(contract).toContain("DIRECT_CONTACT");
    expect(contract).toContain("RELATED_OPPORTUNITY");
    expect(contract).toContain("REJECT");
    expect(contract).toContain("不能仅因为是经销商或代理商就输出 RELATED_OPPORTUNITY");
    expect(contract).toContain("EQUIPMENT_PURCHASE");
    expect(contract).toContain('"additionalProperties": false');
    expect(contract).toContain("派生 Lead 必须重新调用现有 Lead Agent 评分");
    expect(contract).toContain("本分支没有修改运行中的 FastGPT 或 N8N");
  });

  it("is import-safe, placeholder-only, and contains no recursive derived search edge", () => {
    const workflow = readJson("n8n/workflows/baidu-lead-contact-enrichment-v1.1.json");
    const names = workflow.nodes.map((node) => node.name);
    const ids = workflow.nodes.map((node) => node.id);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(ids).size).toBe(ids.length);
    for (const node of workflow.nodes.filter((candidate) => candidate.type === "n8n-nodes-base.code")) {
      expect(() => new Function("$input", "$json", "$", node.parameters.jsCode)).not.toThrow();
    }
    for (const outputs of Object.values(workflow.connections)) {
      for (const branch of outputs.main) {
        for (const edge of branch) expect(names).toContain(edge.node);
      }
    }
    for (const round of [1, 2, 3]) {
      const scoreTargets = workflow.connections[`AI Score Related Opportunity R${round}`].main.flat().map((edge) => edge.node);
      expect(scoreTargets).toEqual([`Build Related Lead R${round}`]);
      expect(scoreTargets).not.toEqual(expect.arrayContaining([
        `Baidu Contact Search R${round}`,
        "Contact Entry Gate",
      ]));
    }
    const serialized = JSON.stringify(workflow);
    expect(serialized).toContain("REPLACE_FASTGPT_CONTACT_VERIFIER_V11_APP_ID");
    expect(serialized).not.toMatch(/"appId":"[a-f0-9]{24}"/u);
    expect(serialized).not.toMatch(/Bearer\s+[A-Za-z0-9._~+/-]{12,}/iu);
    expect(serialized).not.toMatch(/(?:sk-|fastgpt-)[A-Za-z0-9_-]{16,}/iu);
    expect(workflow.settings).toMatchObject({
      saveExecutionProgress: false,
      saveDataErrorExecution: "none",
      saveDataSuccessExecution: "none",
      executionTimeout: 900,
    });
  });
});
