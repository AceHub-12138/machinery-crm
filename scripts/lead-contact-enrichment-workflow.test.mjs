import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildContactEnrichmentWorkflow } from "./build-lead-contact-enrichment-workflow.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(`${root}${path}`, "utf8"));
const readText = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/gu, "\n");

describe("versioned Baidu Lead contact enrichment workflow", () => {
  it("keeps N4 immutable and hard-bounds the independent enrichment path", () => {
    const n4 = readJson("n8n/workflows/baidu-lead-e2e-n4-pass.json");
    const workflow = readJson("n8n/workflows/baidu-lead-contact-enrichment-v1.json");
    const serialized = JSON.stringify(workflow);
    const config = workflow.nodes.find((node) => node.name === "Search Config");
    const assignments = Object.fromEntries(config.parameters.assignments.assignments
      .map(({ name, value }) => [name, value]));
    const prepares = workflow.nodes.filter((node) => /^Prepare Contact Round [123]$/.test(node.name));
    const contactSearches = workflow.nodes.filter((node) => /^Baidu Contact Search R[123]$/.test(node.name));
    const planners = workflow.nodes.filter((node) => /^AI Query Planner R[23]$/.test(node.name));
    const verifiers = workflow.nodes.filter((node) => /^AI Contact Verifier R[123]$/.test(node.name));
    const extractors = workflow.nodes.filter((node) => /^Extract Contact Candidates R[123]$/.test(node.name));
    const idempotency = workflow.nodes.find((node) => node.name === "Lead Idempotency SHA256");
    const leadPayload = workflow.nodes.find((node) => node.name === "Lead MCP Payload");
    const entryGate = workflow.nodes.find((node) => node.name === "Contact Entry Gate");
    const leadAgent = workflow.nodes.find((node) => node.name === "HTTP Request1");
    const payloadFields = leadPayload.parameters.assignments.assignments.map((assignment) => assignment.name);
    const profileAssignment = leadPayload.parameters.assignments.assignments
      .find((assignment) => assignment.name === "profile");

    expect(n4.name).toBe("百度获客-PoC");
    expect(workflow.name).toBe("百度获客-联系方式反查-v1");
    expect(workflow.active).toBe(false);
    expect(assignments).toMatchObject({
      contact_search_enabled: true,
      contact_search_score_threshold: 90,
      contact_search_max_rounds: 3,
      contact_search_top_k: 5,
    });
    expect(prepares).toHaveLength(3);
    expect(contactSearches).toHaveLength(3);
    expect(planners).toHaveLength(2);
    expect(verifiers).toHaveLength(3);
    expect(extractors.every((node) => node.parameters.jsCode.includes("raw?.references"))).toBe(true);
    expect(payloadFields).toEqual(expect.arrayContaining(["contactName", "phone", "email"]));
    expect(profileAssignment.value).toBe("={{ $json.validatedLead.profile }}");
    expect(entryGate.parameters.jsCode).toContain("delete validatedLead.email");
    expect(leadAgent.parameters.jsonBody).toContain("REPLACE_FASTGPT_LEAD_AGENT_APP_ID");
    for (const [index, prepare] of prepares.entries()) {
      const round = index + 1;
      expect(prepare.parameters.jsCode).toContain("contactSearchRound < contactSearchMaxRounds");
      expect(workflow.connections[prepare.name].main[0][0].node).toBe(`Contact Round ${round} Budget Allowed?`);
      expect(workflow.connections[`Contact Round ${round} Budget Allowed?`].main[0][0].node)
        .toBe(round === 1 ? "Baidu Contact Search R1" : `AI Query Planner R${round}`);
    }
    expect(contactSearches.every((node) => node.parameters.jsonBody
      .includes("Math.min(Number($('Search Config').first().json.contact_search_top_k), 5)"))).toBe(true);
    expect(idempotency.parameters.value).toContain("lead-idempotency-v2|");
    expect(idempotency.parameters.value).toContain("$execution.id");
    expect(idempotency.parameters.value).not.toContain("contactSearchRound");
    expect(serialized).toContain("CONTACT_ENRICHMENT_EXHAUSTED");
    expect(serialized).toContain("CONTACT_QUERY_PLANNER_INVALID_OUTPUT");
    expect(serialized).toContain("CONTACT_VERIFIER_INVALID_OUTPUT");
    expect(prepares[0].parameters.jsCode).toContain('"山东省":["济南市","青岛市"');
    expect(workflow.nodes.find((node) => node.name === "Apply Contact Verification R1").parameters.jsCode)
      .toContain("validCities.includes(verifiedCity)");
    expect(serialized).not.toMatch(/Bearer\s+[A-Za-z0-9._~+/-]{12,}/i);
    expect(serialized).not.toMatch(/(?:sk-|fastgpt-)[A-Za-z0-9_-]{16,}/i);
  });

  it("archives exact offline FastGPT planner and verifier contracts without claiming a live change", () => {
    const contract = readText("docs/mcp/LEAD_CONTACT_ENRICHMENT_V1.md");
    expect(contract).toContain("OFFICIAL_CONTACT");
    expect(contract).toContain("REGION_DISAMBIGUATION");
    expect(contract).toContain('"additionalProperties": false');
    expect(contract).toContain('"companyMatched"');
    expect(contract).toContain("禁止直接生成或猜测 phone、email、contactName、province、city");
    expect(contract).toContain("平台客服电话");
    expect(contract).toContain("本分支没有修改运行中的 FastGPT");
  });

  it("keeps the generated workflow reproducible, syntactically valid and failure-isolated", () => {
    const base = readJson("n8n/workflows/baidu-lead-e2e-n4-pass.json");
    const checkedIn = readJson("n8n/workflows/baidu-lead-contact-enrichment-v1.json");
    const withoutEmbeddedCode = (workflow) => ({
      ...workflow,
      nodes: workflow.nodes.map((node) => node.type === "n8n-nodes-base.code"
        ? { ...node, parameters: { ...node.parameters, jsCode: "<validated separately>" } }
        : node),
    });
    expect(withoutEmbeddedCode(buildContactEnrichmentWorkflow(base))).toEqual(withoutEmbeddedCode(checkedIn));
    for (const node of checkedIn.nodes.filter((candidate) => candidate.type === "n8n-nodes-base.code")) {
      expect(() => new Function("$input", "$json", "$", node.parameters.jsCode)).not.toThrow();
    }
    for (const node of checkedIn.nodes.filter((candidate) => (
      /^Baidu Contact Search R[123]$/.test(candidate.name)
      || /^AI Query Planner R[23]$/.test(candidate.name)
      || /^AI Contact Verifier R[123]$/.test(candidate.name)
    ))) {
      expect(node.onError).toBe("continueRegularOutput");
    }
    expect(checkedIn.settings).toMatchObject({
      saveExecutionProgress: false,
      saveDataErrorExecution: "none",
      saveDataSuccessExecution: "none",
      executionTimeout: 900,
    });
    expect(checkedIn.connections["Contact Candidates R1?"].main[1][0].node).toBe("Prepare Contact Round 2");
    expect(checkedIn.connections["Contact Verified R2?"].main[0][0].node).toBe("Final Lead Entry Gate");
    expect(checkedIn.connections["Contact Candidates R3?"].main[1][0].node).toBe("Contact Enrichment Exhausted");
    expect(checkedIn.connections["Query Planner R2 Valid?"].main[1][0].node).toBe("Contact Enrichment Terminal");
  });

  it("validates the unwrapped 3013 MCP business result after HTTP success", () => {
    const workflow = buildContactEnrichmentWorkflow(readJson("n8n/workflows/baidu-lead-e2e-n4-pass.json"));
    const validator = workflow.nodes.find((node) => node.name === "Validate Lead MCP Result");
    expect(validator).toBeTruthy();
    expect(workflow.connections["Lead MCP Upsert"].main[0][0].node).toBe("Validate Lead MCP Result");
    const execute = new Function("$input", "$json", "$", validator.parameters.jsCode);
    const success = {
      jsonrpc: "2.0",
      id: "write-1",
      result: {
        isError: false,
        structuredContent: { ok: true, data: { items: [{ id: "lead-1", writeDisposition: "CREATED" }] }, error: null },
      },
    };
    expect(execute({ all: () => [{ json: success }] }, {}, () => undefined)[0].json.leadWriteResult)
      .toMatchObject({ id: "lead-1", writeDisposition: "CREATED" });

    for (const failure of [
      { ...success, result: { isError: true, structuredContent: { ok: false, data: null, error: { code: "INVALID_ARGUMENT" } } } },
      { ...success, result: { isError: false, structuredContent: { ok: false, data: null, error: { code: "IDEMPOTENCY_CONFLICT" } } } },
      { ...success, result: { isError: false, structuredContent: { ok: true, data: { items: [{}] }, error: null } } },
    ]) {
      expect(() => execute({ all: () => [{ json: failure }] }, {}, () => undefined))
        .toThrow(/LEAD_MCP_WRITE_FAILED/iu);
    }
  });

  it("executes the checked-in entry gate with zero search and safe contact cleanup", () => {
    const workflow = readJson("n8n/workflows/baidu-lead-contact-enrichment-v1.json");
    const code = workflow.nodes.find((node) => node.name === "Contact Entry Gate").parameters.jsCode;
    const execute = new Function("$input", "$json", "$", code);
    const searchConfig = {
      contact_search_enabled: true,
      contact_search_score_threshold: 90,
      contact_search_max_rounds: 3,
      contact_search_top_k: 5,
    };
    const result = execute({
      all: () => [{ json: { validatedLead: {
        companyName: "已有电话企业",
        aiScore: 95,
        phone: " 13800000000 ",
        email: "invalid-email",
      } } }],
    }, {}, () => ({ first: () => ({ json: searchConfig }) }));

    expect(result[0].json).toMatchObject({
      shouldWrite: true,
      shouldSearch: false,
      contactSearchRound: 0,
      validatedLead: { phone: "13800000000" },
    });
    expect(result[0].json.validatedLead).not.toHaveProperty("email");
  });

  it("executes the checked-in Baidu references extractor and rejects mismatched province/city", () => {
    const workflow = readJson("n8n/workflows/baidu-lead-contact-enrichment-v1.json");
    const node = (name) => workflow.nodes.find((candidate) => candidate.name === name);
    const state = {
      validatedLead: { companyName: "目标企业", aiScore: 95, profile: {} },
      previousQueries: ["目标企业 电话 邮箱 联系方式 官网"],
      excludedResults: [],
      contactSearchRound: 1,
    };
    const nodeLookup = (name) => ({
      first: () => ({ json: { contact_search_top_k: 5 } }),
      item: { json: name === "Prepare Contact Round 1" ? state : state },
    });
    const extract = new Function("$input", "$json", "$", node("Extract Contact Candidates R1").parameters.jsCode);
    const extracted = extract({ all: () => [] }, {
      references: [{
        title: "目标企业 联系我们",
        url: "https://target.example.com/contact",
        content: "联系电话 0537-1234567",
      }],
    }, nodeLookup).json;
    expect(extracted).toMatchObject({ hasCandidates: true });
    expect(extracted.candidatePhones[0].value).toBe("0537-1234567");

    const apply = new Function("$input", "$json", "$", node("Apply Contact Verification R1").parameters.jsCode);
    const verification = apply({ all: () => [] }, {
      choices: [{ message: { content: JSON.stringify({
        verified: true,
        companyMatched: true,
        phone: "0537-1234567",
        email: null,
        province: "山东省",
        city: "广州市",
        evidence: "同一官网页面",
      }) } }],
    }, (name) => ({ item: { json: name === "Extract Contact Candidates R1" ? extracted : state } })).json;
    expect(verification).toMatchObject({ verified: false, status: "CONTACT_NOT_VERIFIED" });
  });

  it("preserves valid source URLs through 2048 characters and rejects longer or invalid URLs explicitly", () => {
    const workflow = buildContactEnrichmentWorkflow(readJson("n8n/workflows/baidu-lead-e2e-n4-pass.json"));
    const code = workflow.nodes.find((node) => node.name === "Extract Contact Candidates R1").parameters.jsCode;
    const execute = new Function("$input", "$json", "$", code);
    const state = {
      validatedLead: { companyName: "长链接目标企业", aiScore: 95, profile: {} },
      previousQueries: [],
      excludedResults: [],
      contactSearchRound: 1,
    };
    const nodeLookup = () => ({
      first: () => ({ json: { contact_search_top_k: 5 } }),
      item: { json: state },
    });
    const sourceUrl = `https://example.com/${"a".repeat(2_048 - "https://example.com/".length)}`;
    const result = execute({ all: () => [] }, {
      references: [{ title: "长链接目标企业", url: sourceUrl, content: "联系电话 0510-12345678" }],
    }, nodeLookup).json;

    expect(result.searchResults[0].url).toBe(sourceUrl);
    expect(() => execute({ all: () => [] }, {
      references: [{ title: "超长链接", url: `${sourceUrl}x`, content: "联系电话 0510-12345678" }],
    }, nodeLookup)).toThrow(/INVALID_ARGUMENT.*sourceUrl.*2048/iu);
    expect(() => execute({ all: () => [] }, {
      references: [{ title: "非法链接", url: "not-a-url", content: "联系电话 0510-12345678" }],
    }, nodeLookup)).toThrow(/INVALID_ARGUMENT.*sourceUrl/iu);
  });
});
