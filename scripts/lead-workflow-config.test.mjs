import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildLeadWriteItem } from "./lead-scoring-contract.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(`${root}${path}`, "utf8"));
const readText = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

describe("versioned Lead workflow configurations", () => {
  it("keeps the FastGPT SERVICE signing JWK compatible with Node crypto", () => {
    const patch = readText("deploy/fastgpt/v4.15.1/0001-dachuan-trusted-mcp-identity.patch");
    expect(patch).toMatch(/^\+import \{[^\n]*type JsonWebKey[^\n]*\} from 'node:crypto';$/m);
  });

  it("keeps scoring model-independent, strict and free of MCP write access", () => {
    const workflow = readJson("deploy/fastgpt/v4.15.1/workflows/lead-score-agent-v1.json");
    const serialized = JSON.stringify(workflow);
    const codeNode = workflow.modules.find((node) => node.nodeId === "lockScore");
    expect(workflow.type).toBe("advanced");
    expect(workflow.modules.map((node) => node.flowNodeType)).toEqual(["workflowStart", "chatNode", "code", "answerNode"]);
    expect(serialized).toContain("REPLACE_IN_FASTGPT_UI");
    expect(serialized).toContain("LEAD_SCORE_JSON_INVALID");
    expect(serialized).toContain("LEAD_SCORING_VERSION_NOT_CONFIGURED");
    expect(serialized).toContain("sourceModelVersion");
    expect(serialized).not.toContain("lead_upsert");
    expect(serialized).not.toContain("lead_list");
    expect(codeNode.inputs.filter((input) => ["scoreJson", "sourceModelVersion", "extractorVersion"].includes(input.key)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ key: "scoreJson", canEdit: true }),
        expect.objectContaining({ key: "sourceModelVersion", canEdit: true }),
        expect.objectContaining({ key: "extractorVersion", canEdit: true }),
      ]));
  });

  it("validates a complete scored page before one batched lead_upsert call", () => {
    const workflow = readJson("deploy/fastgpt/v4.15.1/workflows/lead-write-agent-v1.json");
    const serialized = JSON.stringify(workflow);
    const tool = workflow.modules.find((node) => node.nodeId === "leadUpsert");
    const codeNode = workflow.modules.find((node) => node.nodeId === "buildPage");
    expect(workflow.type).toBe("advanced");
    expect(workflow.modules.map((node) => node.flowNodeType)).toEqual(["workflowStart", "code", "tool", "answerNode"]);
    expect(serialized).toContain("LEAD_WRITE_PAGE_SIZE_INVALID");
    expect(serialized).toContain("LEAD_SCORE_JSON_INVALID");
    expect(serialized).toContain("LEAD_IDEMPOTENCY_KEY_INVALID");
    expect(serialized).toContain("lead.idempotencyKey === lead.requestId");
    expect(serialized).toContain("crypto.subtle.digest('SHA-256'");
    expect(tool.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "items", value: ["buildPage", "items"] }),
    ]));
    expect(tool.toolConfig.mcpTool.toolId).toContain("/lead_upsert");
    expect(codeNode.inputs.filter((input) => ["scoredPageJson"].includes(input.key)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ key: "scoredPageJson", canEdit: true }),
      ]));
    expect(serialized).not.toContain("chatNode");
    expect(serialized).not.toContain("lead_list");
  });

  it("builds the MCP canonical hash from a locked page and rejects one invalid score", async () => {
    const workflow = readJson("deploy/fastgpt/v4.15.1/workflows/lead-write-agent-v1.json");
    const code = workflow.modules.find((node) => node.nodeId === "buildPage").inputs.find((input) => input.key === "code").value;
    const runWritePage = new Function(`${code}; return main;`)();
    const sourceLead = {
      idempotencyKey: "lead-v1-behavior-test-0001",
      requestId: "trace-behavior-0001",
      companyName: "  大川测试制造  ",
      source: "BAIDU_SEARCH",
      sourceUrl: "https://example.com/lead/1",
      searchKeyword: "  数控机床采购  ",
      sourceSystem: "n8n-test",
      externalLeadId: "external-0001",
    };
    const score = {
      aiScore: 88,
      profile: {
        industry: "  金属加工  ",
        intent: "明确询价",
        scale: "中型企业",
        contactability: "公开电话",
        confidence: "high",
        reason: "行业和采购信号明确",
      },
    };
    const page = [{ sourceLead, score, sourceModelVersion: "model-test-v1", extractorVersion: "lead-score-v1" }];
    const actual = await runWritePage({ scoredPageJson: JSON.stringify(page) });
    expect(actual.items).toEqual([buildLeadWriteItem({ sourceLead, score, sourceModelVersion: "model-test-v1", extractorVersion: "lead-score-v1" })]);

    const invalidPage = [...page, { ...page[0], sourceLead: { ...sourceLead, idempotencyKey: "lead-v1-behavior-test-0002" }, score: { ...score, aiScore: 101 } }];
    await expect(runWritePage({ scoredPageJson: JSON.stringify(invalidPage) })).rejects.toThrow("LEAD_SCORE_JSON_INVALID_1");
  });

  it("preserves sourceUrl through 2048 characters in the archived FastGPT writer", async () => {
    const writeWorkflow = readJson("deploy/fastgpt/v4.15.1/workflows/lead-write-agent-v1.json");
    const writeCode = writeWorkflow.modules.find((node) => node.nodeId === "buildPage")
      .inputs.find((input) => input.key === "code").value;
    const runWrite = new Function(`${writeCode}; return main;`)();
    const sourceUrl = `https://example.com/${"a".repeat(2_048 - "https://example.com/".length)}`;
    const sourceLead = {
      idempotencyKey: "lead-v1-region-long-url-0001",
      companyName: "江阴长链接测试有限公司",
      source: "BAIDU_SEARCH",
      sourceUrl,
      sourceSystem: "n8n-test",
      externalLeadId: "region-long-url-1",
    };
    const score = {
      aiScore: 88,
      profile: {
        industry: "金属加工",
        intent: "明确询价",
        scale: "中型企业",
        contactability: "公开电话",
        confidence: "high",
        reason: "行业和采购信号明确",
        province: "江苏省",
        city: "无锡市",
      },
    };
    const actual = await runWrite({
      scoredPageJson: JSON.stringify([{
        sourceLead,
        score,
        sourceModelVersion: "model-test-v1",
        extractorVersion: "lead-score-v1",
      }]),
    });
    expect(actual.items[0]).toEqual(buildLeadWriteItem({
      sourceLead,
      score,
      sourceModelVersion: "model-test-v1",
      extractorVersion: "lead-score-v1",
    }));
    await expect(runWrite({
      scoredPageJson: JSON.stringify([{
        sourceLead: { ...sourceLead, sourceUrl: `${sourceUrl}x` },
        score,
        sourceModelVersion: "model-test-v1",
        extractorVersion: "lead-score-v1",
      }]),
    })).rejects.toThrow("LEAD_SOURCE_URL_INVALID_0");
    await expect(runWrite({
      scoredPageJson: JSON.stringify([{
        sourceLead: { ...sourceLead, sourceUrl: ` ${sourceUrl} ` },
        score,
        sourceModelVersion: "model-test-v1",
        extractorVersion: "lead-score-v1",
      }]),
    })).rejects.toThrow("LEAD_SOURCE_URL_INVALID_0");
    await expect(runWrite({
      scoredPageJson: JSON.stringify([{
        sourceLead,
        score: { ...score, profile: { ...score.profile, city: "广州市" } },
        sourceModelVersion: "model-test-v1",
        extractorVersion: "lead-score-v1",
      }]),
    })).rejects.toThrow("LEAD_SCORE_JSON_INVALID_0");
  });

  it("scores a page before one stable retried write and stores no secret", () => {
    const workflow = readJson("n8n/workflows/lead-staging-v1.json");
    const serialized = JSON.stringify(workflow);
    const batch = workflow.nodes.find((node) => node.id === "batch-leads");
    const scoreRequest = workflow.nodes.find((node) => node.id === "call-score-agent");
    const aggregate = workflow.nodes.find((node) => node.id === "lock-scored-page");
    const writeRequest = workflow.nodes.find((node) => node.id === "call-write-agent");
    const webhook = workflow.nodes.find((node) => node.id === "lead-webhook");
    for (const node of workflow.nodes.filter((candidate) => candidate.type === "n8n-nodes-base.code")) {
      expect(() => new Function("require", "$input", "$json", "$", node.parameters.jsCode)).not.toThrow();
    }
    expect(batch.parameters.batchSize).toBe(20);
    expect(scoreRequest.retryOnFail).toBe(true);
    expect(scoreRequest.onError).toBe("stopWorkflow");
    expect(aggregate.parameters.mode).toBe("runOnceForAllItems");
    expect(aggregate.onError).toBe("stopWorkflow");
    expect(writeRequest.retryOnFail).toBe(true);
    expect(writeRequest.maxTries).toBe(3);
    expect(writeRequest.onError).toBe("stopWorkflow");
    expect(writeRequest.parameters.jsonBody).toContain("$json.lockedPageJson");
    expect(writeRequest.parameters.jsonBody).not.toContain("$runIndex");
    const mapResults = workflow.nodes.find((node) => node.id === "map-write-results");
    expect(mapResults.onError).toBe("stopWorkflow");
    expect(mapResults.parameters.mode).toBe("runOnceForAllItems");
    expect(mapResults.parameters.jsCode).toContain("$input.first().json");
    expect(serialized).toContain("lead-idempotency-v1|");
    expect(serialized).toContain("LEAD_IDEMPOTENCY_INVALID_");
    expect(serialized).toContain("LEAD_SCORE_PAGE_INVALID");
    expect(serialized).toContain("LEAD_WRITE_PAGE_RESULT_INVALID");
    expect(mapResults.parameters.jsCode).toContain("'CONFIRMED_DUPLICATE','CONFIRMED_UNIQUE'");
    expect(serialized).toContain("X-Dachuan-Request-Id");
    expect(serialized).not.toContain("lead_list");
    expect(serialized).not.toContain("require('crypto')");
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]{16,}|fastgpt-[A-Za-z0-9_-]{16,}/);
    expect(scoreRequest.credentials.httpHeaderAuth.id).toBe("REPLACE_SCORE_AGENT_CREDENTIAL");
    expect(writeRequest.credentials.httpHeaderAuth.id).toBe("REPLACE_WRITE_AGENT_CREDENTIAL");
    expect(scoreRequest.credentials.httpHeaderAuth.id).not.toBe(writeRequest.credentials.httpHeaderAuth.id);
    expect(workflow.connections["Loop in Pages of 20"].main[0][0].node).toBe("Return Lead Write Results");
    expect(workflow.connections["Loop in Pages of 20"].main[1][0].node).toBe("Call FastGPT Score Agent");
    expect(webhook.parameters.authentication).toBe("headerAuth");
    expect(webhook.credentials.httpHeaderAuth.id).toBe("REPLACE_N8N_INGRESS_CREDENTIAL");
    expect(workflow.settings).toMatchObject({ saveExecutionProgress: false, saveDataErrorExecution: "none", saveDataSuccessExecution: "none" });
  });

  it("archives the 2026-08-20 N4 production-pass Baidu workflow with v2 idempotency and credential placeholders", () => {
    const workflow = readJson("n8n/workflows/baidu-lead-e2e-n4-pass.json");
    const serialized = JSON.stringify(workflow);
    const searchConfig = workflow.nodes.find((node) => node.name === "Search Config");
    const baiduRequest = workflow.nodes.find((node) => node.name === "HTTP Request");
    const fastGptRequest = workflow.nodes.find((node) => node.name === "HTTP Request1");
    const canonicalPayload = workflow.nodes.find((node) => node.name === "Canonical Lead Payload");
    const payloadHash = workflow.nodes.find((node) => node.name === "Lead Payload SHA256");
    const idempotencyHash = workflow.nodes.find((node) => node.name === "Lead Idempotency SHA256");
    const finalize = workflow.nodes.find((node) => node.name === "Finalize Lead MCP Item");
    const leadUpsert = workflow.nodes.find((node) => node.name === "Lead MCP Upsert");

    expect(searchConfig.parameters.assignments.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "search_keyword", type: "string" }),
    ]));
    expect(workflow.connections["Search Config"].main[0][0].node).toBe("HTTP Request");
    expect(JSON.stringify(baiduRequest.parameters)).toContain("$('Search Config').item.json.search_keyword");
    expect(canonicalPayload.parameters.jsCode).toContain("const canonicalJson = JSON.stringify(canonicalPayload)");
    expect(payloadHash.type).toBe("n8n-nodes-base.crypto");
    expect(payloadHash.parameters).toMatchObject({ value: "={{ $json.canonicalJson }}", dataPropertyName: "payloadHash" });
    expect(idempotencyHash.type).toBe("n8n-nodes-base.crypto");
    expect(idempotencyHash.parameters.value).toContain("lead-idempotency-v2|");
    expect(idempotencyHash.parameters.value).toContain("$execution.id");
    expect(idempotencyHash.parameters.value).toContain("canonicalPayload.sourceSystem");
    expect(idempotencyHash.parameters.value).toContain("canonicalPayload.sourceUrl");
    expect(finalize.parameters.jsCode).toContain("const idempotencyKey = `lead-v2-${idempotencyDigest}`");
    expect(serialized).not.toContain("lead-idempotency-v1|");
    expect(serialized).not.toContain("lead-v1-");

    expect(fastGptRequest.parameters.authentication).toBe("genericCredentialType");
    expect(fastGptRequest.credentials.httpHeaderAuth).toEqual({
      id: "REPLACE_FASTGPT_LEAD_AGENT_CREDENTIAL",
      name: "FastGPT Lead Agent",
    });
    expect(leadUpsert.parameters.authentication).toBe("genericCredentialType");
    expect(leadUpsert.credentials.httpHeaderAuth).toEqual({
      id: "REPLACE_LEAD_INGESTOR_CREDENTIAL",
      name: "Dachuan Lead Ingestor",
    });
    expect(baiduRequest.credentials.httpHeaderAuth).toEqual({
      id: "REPLACE_BAIDU_SEARCH_CREDENTIAL",
      name: "Header Auth account",
    });

    expect(serialized).not.toMatch(/Bearer\s+[A-Za-z0-9._~+/-]{12,}/i);
    expect(serialized).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
    expect(serialized).not.toMatch(/-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/);
    expect(serialized).not.toMatch(/(?:sk-|fastgpt-)[A-Za-z0-9_-]{16,}/i);
    expect(serialized).not.toMatch(/(?:mysql|postgres(?:ql)?):\/\/[^:\s]+:[^@\s]+@/i);
  });

  it("collects and scans Lead E2E logs even when the real chain fails", () => {
    const workflow = readText(".github/workflows/full-readonly-linux-acceptance.yml");
    expect(workflow).toMatch(/- name: FastGPT SERVICE 断言到 Lead 写库真实链路\s+id: lead-e2e-chain/);
    expect(workflow).toMatch(/- name: 收集 Lead E2E 服务日志\s+if: always\(\)/);
    expect(workflow).toMatch(/- name: Lead 链路敏感信息终审\s+if: always\(\)/);
    expect(workflow).toContain("LEAD_E2E_CHAIN_OUTCOME: ${{ steps.lead-e2e-chain.outcome }}");
    expect(workflow).toMatch(/- name: 清除本次隔离栈和命名卷\s+if: always\(\)/);
  });

  it("gives the isolated Lead MCP the framework secret required by real MCP requests", () => {
    const compose = readText("deploy/identity-acceptance/docker-compose.yml");
    const leadService = compose.match(/\n  lead-mcp:\n([\s\S]*?)\n  lead-llm-mock:/)?.[1] || "";
    expect(leadService).toContain("AUTH_SECRET: ${AUTH_SECRET}");
  });

  it("normalizes the Windows PowerShell runtime gate before passing it to Linux sh", () => {
    const script = readText("deploy/identity-acceptance/build-fastgpt.ps1");
    expect(script).toContain('$runtimeGate = $runtimeGate.Replace("`r`n", "`n")');
  });
});
