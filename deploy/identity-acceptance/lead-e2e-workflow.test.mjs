import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLeadE2eWorkflow, updateLeadE2eEnv } from "./lead-e2e-workflow.mjs";

const readWorkflow = (name) => JSON.parse(readFileSync(new URL(`../fastgpt/v4.15.1/workflows/${name}`, import.meta.url), "utf8"));

describe("isolated FastGPT Lead E2E workflow", () => {
  it("uses the provider-independent mock and the single Lead write tool", () => {
    const toolSetId = "a".repeat(24);
    const workflow = buildLeadE2eWorkflow({ toolSetId, mockUrl: "http://lead-llm-mock:4010/v1/chat/completions" });
    expect(workflow.modules.map((node) => node.flowNodeType)).toEqual(["workflowStart", "httpRequest468", "code", "code", "code", "tool", "answerNode"]);
    const httpNode = workflow.modules[1];
    const scoreLockNode = workflow.modules[2];
    const assembleNode = workflow.modules[3];
    const codeNode = workflow.modules[4];
    expect(workflow.modules[5].toolConfig.mcpTool.toolId).toBe(`mcp-${toolSetId}/lead_upsert`);
    expect(httpNode.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "rawLead", value: ["leadStart", "userChatInput"], canEdit: true }),
      expect.objectContaining({ key: "system_httpReqUrl", value: "http://lead-llm-mock:4010/v1/chat/completions" }),
      expect.objectContaining({ key: "system_httpMethod", value: "POST" }),
      expect.objectContaining({ key: "system_httpContentType", value: "json" }),
    ]));
    expect(httpNode.outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "httpRawResponse", key: "httpRawResponse" }),
      expect.objectContaining({ id: "scoreJson", key: "$.choices[0].message.content" }),
    ]));
    const scoreCode = scoreLockNode.inputs.find((input) => input.key === "code")?.value;
    const writeCode = codeNode.inputs.find((input) => input.key === "code")?.value;
    const productionScoreCode = readWorkflow("lead-score-agent-v1.json").modules.find((node) => node.nodeId === "lockScore").inputs.find((input) => input.key === "code").value;
    const productionWriteCode = readWorkflow("lead-write-agent-v1.json").modules.find((node) => node.nodeId === "buildPage").inputs.find((input) => input.key === "code").value;
    expect(scoreCode).toBe(productionScoreCode);
    expect(writeCode).toBe(productionWriteCode);
    expect(scoreCode).toContain("LEAD_SCORE_JSON_INVALID");
    expect(writeCode).toContain("lead.idempotencyKey === lead.requestId");
    expect(writeCode).toContain("sourceModelVersion");
    expect(JSON.stringify(workflow)).not.toContain("fetch(");
    expect(scoreLockNode.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "scoreJson", value: ["leadScoreHttp", "scoreJson"], canEdit: true }),
      expect.objectContaining({ key: "sourceModelVersion", value: "deepseek-ci-mock-v1", canEdit: true }),
      expect.objectContaining({ key: "extractorVersion", value: "lead-score-v1", canEdit: true }),
    ]));
    expect(assembleNode.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "rawLead", value: ["leadStart", "userChatInput"], canEdit: true }),
      expect.objectContaining({ key: "lockedScoreJson", value: ["leadLockScore", "lockedScoreJson"], canEdit: true }),
    ]));
    expect(codeNode.inputs.filter((input) => ["scoredPageJson"].includes(input.key)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ key: "scoredPageJson", value: ["leadAssemble", "scoredPageJson"], canEdit: true }),
      ]));
    expect(workflow.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "leadStart", target: "leadScoreHttp" }),
      expect.objectContaining({ source: "leadScoreHttp", target: "leadLockScore" }),
      expect.objectContaining({ source: "leadLockScore", target: "leadAssemble" }),
      expect.objectContaining({ source: "leadAssemble", target: "leadBuild" }),
    ]));
  });

  it("validates a mock completion and builds a single canonical write item without sandbox networking", async () => {
    const workflow = buildLeadE2eWorkflow({ toolSetId: "a".repeat(24), mockUrl: "http://lead-llm-mock:4010/v1/chat/completions" });
    const scoreCode = workflow.modules.find((node) => node.nodeId === "leadLockScore").inputs.find((input) => input.key === "code").value;
    const assembleCode = workflow.modules.find((node) => node.nodeId === "leadAssemble").inputs.find((input) => input.key === "code").value;
    const writeCode = workflow.modules.find((node) => node.nodeId === "leadBuild").inputs.find((input) => input.key === "code").value;
    const lockScore = new Function(`${scoreCode}; return main;`)();
    const assemble = new Function(`${assembleCode}; return main;`)();
    const buildWrite = new Function(`${writeCode}; return main;`)();
    const lead = {
      companyName: "Dachuan E2E",
      source: "BAIDU_SEARCH",
      sourceSystem: "n8n-lead-staging-e2e",
      externalLeadId: "external-e2e-1",
      idempotencyKey: "n8n-lead-e2e-external-e2e-1",
      requestId: "trace-e2e-0001",
    };
    const score = {
      aiScore: 86,
      profile: {
        industry: "machine-tool-manufacturing",
        intent: "clear-purchase-signal",
        scale: "medium",
        contactability: "direct-contact-available",
        confidence: "high",
        reason: "Four-dimensional evidence.",
      },
    };
    const locked = await lockScore({ scoreJson: JSON.stringify(score), sourceModelVersion: "deepseek-ci-mock-v1", extractorVersion: "lead-score-v1" });
    const page = await assemble({ rawLead: JSON.stringify(lead), lockedScoreJson: locked.lockedScoreJson });
    const result = await buildWrite({ scoredPageJson: page.scoredPageJson });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ companyName: lead.companyName, source: lead.source, sourceSystem: lead.sourceSystem, externalLeadId: lead.externalLeadId, idempotencyKey: lead.idempotencyKey, aiScore: 86, sourceModelVersion: "deepseek-ci-mock-v1", extractorVersion: "lead-score-v1" });
    expect(result.items[0]).not.toHaveProperty("requestId");
    expect(result.items[0].payloadHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("atomically enables signing only for the provisioned application", () => {
    const appId = "b".repeat(24);
    const key = `fastgpt-${"c".repeat(32)}-${appId}`;
    const updated = updateLeadE2eEnv([
      "LEAD_SERVICE_ASSERTION_ENABLED=false",
      "LEAD_SERVICE_ASSERTION_APP_IDS=REPLACE_WITH_LEAD_AGENT_APP_ID",
      "LEAD_E2E_FASTGPT_API_KEY=REPLACE_WITH_LEAD_E2E_FASTGPT_APP_KEY",
    ].join("\n"), { appId, apiKey: key });
    expect(updated).toContain("LEAD_SERVICE_ASSERTION_ENABLED=true");
    expect(updated).toContain(`LEAD_SERVICE_ASSERTION_APP_IDS=${appId}`);
    expect(updated).toContain(`LEAD_E2E_FASTGPT_API_KEY=${key}`);
  });
});
