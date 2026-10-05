import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export const FIXED_LEAD_SCORE = Object.freeze({
  aiScore: 86,
  profile: {
    industry: "machine-tool-manufacturing",
    intent: "clear-purchase-signal",
    scale: "medium",
    contactability: "direct-contact-available",
    confidence: "high",
    reason: "Industry 28/30, intent 26/30, scale 15/20, contactability 17/20.",
  },
  contactName: "CI Contact",
  phone: "13800000000",
  email: "lead-e2e@example.invalid",
});

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

async function readJson(request) {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (Buffer.byteLength(text) > 64 * 1024) throw new Error("REQUEST_TOO_LARGE");
  }
  return JSON.parse(text || "{}");
}

export function createLeadLlmMockServer() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, JSON_HEADERS).end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404, JSON_HEADERS).end(JSON.stringify({ error: "NOT_FOUND" }));
      return;
    }
    try {
      const input = await readJson(request);
      const rawLead = input?.messages?.at?.(-1)?.content;
      const lead = typeof rawLead === "string" ? JSON.parse(rawLead) : {};
      const score = lead?.mockMode === "invalid-score" ? { ...FIXED_LEAD_SCORE, aiScore: 101 } : FIXED_LEAD_SCORE;
      response.writeHead(200, JSON_HEADERS).end(JSON.stringify({
        id: "chatcmpl-lead-e2e-fixed",
        object: "chat.completion",
        model: "deepseek-ci-mock-v1",
        choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(score) }, finish_reason: "stop" }],
      }));
    } catch {
      response.writeHead(400, JSON_HEADERS).end(JSON.stringify({ error: "INVALID_JSON" }));
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = String(process.env.LEAD_LLM_MOCK_HOST || "127.0.0.1");
  const port = Number(process.env.LEAD_LLM_MOCK_PORT || 4010);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("LEAD_LLM_MOCK_PORT is invalid");
  createLeadLlmMockServer().listen(port, host, () => {
    console.log(`LEAD_LLM_MOCK=READY port=${port}`);
  });
}
