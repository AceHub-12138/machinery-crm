import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { FIXED_LEAD_SCORE, createLeadLlmMockServer } from "./lead-llm-mock.mjs";

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function start() {
  const server = createLeadLlmMockServer();
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock server address unavailable");
  return `http://127.0.0.1:${address.port}`;
}

describe("model-independent Lead scoring mock", () => {
  it("returns the fixed strict score without requiring a provider key", async () => {
    const baseUrl = await start();
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "deepseek-ci-mock-v1", messages: [{ role: "user", content: JSON.stringify({ companyName: "Acceptance Lead" }) }] }),
    });
    expect(response.status).toBe(200);
    const completion = await response.json();
    expect(JSON.parse(completion.choices[0].message.content)).toEqual(FIXED_LEAD_SCORE);
  });

  it("can return an invalid score for fail-closed workflow acceptance", async () => {
    const baseUrl = await start();
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: JSON.stringify({ mockMode: "invalid-score" }) }] }),
    });
    const completion = await response.json();
    expect(JSON.parse(completion.choices[0].message.content).aiScore).toBe(101);
  });
});
