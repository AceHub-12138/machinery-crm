import { readFileSync } from "node:fs";

function loadCodeNode(workflowName, nodeId) {
  const workflow = JSON.parse(readFileSync(new URL(`../fastgpt/v4.15.1/workflows/${workflowName}`, import.meta.url), "utf8"));
  const node = workflow.modules?.find((candidate) => candidate.nodeId === nodeId);
  if (!node || node.flowNodeType !== "code") throw new Error(`Missing production code node ${workflowName}/${nodeId}`);
  return structuredClone(node);
}

const ASSEMBLE_CODE = `async function main({rawLead, lockedScoreJson}) {
  const sourceLead = JSON.parse(rawLead);
  const locked = JSON.parse(lockedScoreJson);
  return { scoredPageJson: JSON.stringify([{ sourceLead, score: locked.score, sourceModelVersion: locked.sourceModelVersion, extractorVersion: locked.extractorVersion }]) };
}`;

const MOCK_REQUEST_BODY = JSON.stringify({
  model: "deepseek-ci-mock-v1",
  messages: [{ role: "user", content: "{{rawLead}}" }],
  temperature: 0,
  max_tokens: 600,
});

export function buildLeadE2eWorkflow({ toolSetId, mockUrl }) {
  if (!/^[a-f\d]{24}$/i.test(toolSetId)) throw new Error("toolSetId is invalid");
  const parsedMockUrl = new URL(mockUrl);
  if (parsedMockUrl.protocol !== "http:" || parsedMockUrl.hostname !== "lead-llm-mock" || parsedMockUrl.port !== "4010" || parsedMockUrl.pathname !== "/v1/chat/completions") {
    throw new Error("mockUrl must target the isolated lead-llm-mock service");
  }
  const scoreLockNode = loadCodeNode("lead-score-agent-v1.json", "lockScore");
  scoreLockNode.nodeId = "leadLockScore";
  scoreLockNode.name = "Validate mock score with production contract";
  scoreLockNode.position = { x: 750, y: 100 };
  scoreLockNode.inputs = scoreLockNode.inputs.map((input) => {
    if (input.key === "scoreJson") return { ...input, value: ["leadScoreHttp", "scoreJson"] };
    if (input.key === "sourceModelVersion") return { ...input, value: "deepseek-ci-mock-v1" };
    if (input.key === "extractorVersion") return { ...input, value: "lead-score-v1" };
    return input;
  });
  const writePageNode = loadCodeNode("lead-write-agent-v1.json", "buildPage");
  writePageNode.nodeId = "leadBuild";
  writePageNode.name = "Validate page with production write contract";
  writePageNode.position = { x: 1250, y: 100 };
  writePageNode.inputs = writePageNode.inputs.map((input) => input.key === "scoredPageJson"
    ? { ...input, value: ["leadAssemble", "scoredPageJson"] }
    : input);
  return {
    modules: [
      {
        flowNodeType: "workflowStart",
        name: "Lead input",
        version: "481",
        nodeId: "leadStart",
        inputs: [{ key: "userChatInput", label: "Lead JSON", valueType: "string", required: true, renderTypeList: ["reference", "textarea"] }],
        outputs: [{ id: "userChatInput", key: "userChatInput", type: "static", valueType: "string", label: "Lead JSON" }],
        position: { x: 100, y: 100 },
      },
      {
        flowNodeType: "httpRequest468",
        name: "Call isolated Lead scoring mock",
        intro: "CI-only OpenAI-compatible scoring endpoint",
        version: "481",
        nodeId: "leadScoreHttp",
        inputs: [
          { key: "system_addInputParam", label: "", valueType: "dynamic", renderTypeList: ["addInputParam"], required: false },
          { key: "rawLead", label: "Raw lead", valueType: "string", renderTypeList: ["reference"], value: ["leadStart", "userChatInput"], required: true, canEdit: true },
          { key: "system_httpMethod", label: "", valueType: "string", renderTypeList: ["custom"], value: "POST", required: true },
          { key: "system_httpTimeout", label: "", valueType: "number", renderTypeList: ["custom"], value: 30, required: true },
          { key: "system_httpReqUrl", label: "", valueType: "string", renderTypeList: ["hidden"], value: mockUrl, required: true },
          { key: "system_httpHeader", label: "", valueType: "any", renderTypeList: ["custom"], value: [], required: false },
          { key: "system_httpParams", label: "", valueType: "any", renderTypeList: ["hidden"], value: [], required: false },
          { key: "system_httpJsonBody", label: "", valueType: "any", renderTypeList: ["hidden"], value: MOCK_REQUEST_BODY, required: true },
          { key: "system_httpFormBody", label: "", valueType: "any", renderTypeList: ["hidden"], value: [], required: false },
          { key: "system_httpContentType", label: "", valueType: "string", renderTypeList: ["hidden"], value: "json", required: true },
        ],
        outputs: [
          { id: "system_addOutputParam", key: "system_addOutputParam", label: "", valueType: "dynamic", type: "dynamic" },
          { id: "scoreJson", key: "$.choices[0].message.content", label: "Strict score JSON", valueType: "string", type: "dynamic" },
          { id: "error", key: "error", label: "Request error", valueType: "object", type: "static" },
          { id: "httpRawResponse", key: "httpRawResponse", label: "Raw response", valueType: "any", type: "static", required: true },
        ],
        position: { x: 450, y: 100 },
      },
      scoreLockNode,
      {
        flowNodeType: "code",
        name: "Assemble one scored page",
        version: "1",
        nodeId: "leadAssemble",
        inputs: [
          { key: "system_addInputParam", label: "", valueType: "dynamic", renderTypeList: ["addInputParam"], required: false },
          { key: "rawLead", label: "Raw lead", valueType: "string", renderTypeList: ["reference"], value: ["leadStart", "userChatInput"], required: true, canEdit: true },
          { key: "lockedScoreJson", label: "Locked score", valueType: "string", renderTypeList: ["reference"], value: ["leadLockScore", "lockedScoreJson"], required: true, canEdit: true },
          { key: "codeType", label: "", valueType: "string", renderTypeList: ["hidden"], value: "js" },
          { key: "code", label: "", valueType: "string", renderTypeList: ["custom"], value: ASSEMBLE_CODE },
        ],
        outputs: [
          { id: "system_addOutputParam", key: "system_addOutputParam", label: "", valueType: "dynamic", type: "dynamic" },
          { id: "scoredPageJson", key: "scoredPageJson", label: "Scored page JSON", valueType: "string", type: "dynamic" },
          { id: "system_rawResponse", key: "system_rawResponse", label: "Raw response", valueType: "object", type: "static" },
          { id: "system_error", key: "system_error", label: "Error", valueType: "string", type: "error" },
        ],
        position: { x: 1000, y: 100 },
      },
      writePageNode,
      {
        flowNodeType: "tool",
        name: "Lead Write MCP/lead_upsert",
        intro: "CI-only isolated Lead writer",
        version: "",
        nodeId: "leadUpsert",
        inputs: [{ key: "items", label: "items", valueType: "arrayObject", renderTypeList: ["reference"], value: ["leadBuild", "items"], required: true }],
        outputs: [{ id: "system_rawResponse", key: "system_rawResponse", type: "static", valueType: "any", label: "Write result", required: true }],
        toolConfig: { mcpTool: { toolId: `mcp-${toolSetId}/lead_upsert` } },
        position: { x: 1500, y: 100 },
      },
      {
        flowNodeType: "answerNode",
        name: "Return write result",
        version: "481",
        nodeId: "leadAnswer",
        inputs: [{ key: "text", label: "Response", valueType: "any", required: true, renderTypeList: ["reference"], value: ["leadUpsert", "system_rawResponse"] }],
        outputs: [],
        position: { x: 1750, y: 100 },
      },
    ],
    edges: [
      { source: "leadStart", sourceHandle: "leadStart-source-right", target: "leadScoreHttp", targetHandle: "leadScoreHttp-target-left" },
      { source: "leadScoreHttp", sourceHandle: "leadScoreHttp-source-right", target: "leadLockScore", targetHandle: "leadLockScore-target-left" },
      { source: "leadLockScore", sourceHandle: "leadLockScore-source-right", target: "leadAssemble", targetHandle: "leadAssemble-target-left" },
      { source: "leadAssemble", sourceHandle: "leadAssemble-source-right", target: "leadBuild", targetHandle: "leadBuild-target-left" },
      { source: "leadBuild", sourceHandle: "leadBuild-source-right", target: "leadUpsert", targetHandle: "leadUpsert-target-left" },
      { source: "leadUpsert", sourceHandle: "leadUpsert-source-right", target: "leadAnswer", targetHandle: "leadAnswer-target-left" },
    ],
    chatConfig: { variables: [] },
  };
}

export function updateLeadE2eEnv(content, { appId, apiKey }) {
  if (!/^[a-f\d]{24}$/i.test(appId)) throw new Error("appId is invalid");
  if (!/^fastgpt-[A-Za-z0-9_-]{20,}-[a-f\d]{24}$/i.test(apiKey)) throw new Error("apiKey is invalid");
  let updated = content
    .replace(/^LEAD_SERVICE_ASSERTION_ENABLED=.*$/m, "LEAD_SERVICE_ASSERTION_ENABLED=true")
    .replace(/^LEAD_SERVICE_ASSERTION_APP_IDS=.*$/m, `LEAD_SERVICE_ASSERTION_APP_IDS=${appId}`)
    .replace(/^LEAD_E2E_FASTGPT_API_KEY=.*$/m, `LEAD_E2E_FASTGPT_API_KEY=${apiKey}`);
  if (updated === content || !updated.includes(`LEAD_SERVICE_ASSERTION_APP_IDS=${appId}`) || !updated.includes(`LEAD_E2E_FASTGPT_API_KEY=${apiKey}`)) {
    throw new Error("Unable to update Lead E2E environment placeholders");
  }
  return updated;
}
