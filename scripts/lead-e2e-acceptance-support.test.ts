import { describe, expect, it } from "vitest";
import {
  buildLeadE2eCompletionBody,
  findLeadWriteResult,
  safeLeadE2eFailure,
  safeLeadE2eResponseSummary,
} from "./lead-e2e-acceptance-support";

describe("Lead E2E response support", () => {
  it("requests the complete FastGPT workflow response for the MCP result", () => {
    const lead = { idempotencyKey: "lead-e2e-detail-0001", companyName: "Dachuan E2E" };
    expect(buildLeadE2eCompletionBody(lead)).toEqual({
      stream: false,
      detail: true,
      messages: [{ role: "user", content: JSON.stringify(lead) }],
    });
  });

  it("finds a nested MCP write result inside a FastGPT answer string", () => {
    const item = { id: "lead-1", dedupStatus: "CONFIRMED_UNIQUE", duplicateOfLeadId: null, replay: false };
    const response = { choices: [{ message: { content: JSON.stringify({
      isError: false,
      structuredContent: { ok: true, data: { items: [item] } },
    }) } }] };
    expect(findLeadWriteResult(response)).toEqual(item);
  });

  it("accepts only a successful unwrapped 3013 MCP business result", () => {
    const item = { id: "lead-3013", dedupStatus: "UNIQUE", duplicateOfLeadId: null, replay: false };
    const response = {
      jsonrpc: "2.0",
      id: "mcp-3013",
      result: {
        isError: false,
        structuredContent: { ok: true, data: { items: [item] }, error: null },
      },
    };
    expect(findLeadWriteResult(response)).toEqual(item);
  });

  it.each([
    ["isError=true", true, true],
    ["structuredContent.ok=false", false, false],
  ])("rejects a 3013 response when %s even if a nested item exists", (_label, isError, ok) => {
    const item = { id: "must-not-pass", dedupStatus: "UNIQUE", duplicateOfLeadId: null, replay: false };
    const response = {
      jsonrpc: "2.0",
      id: "mcp-3013-failure",
      result: {
        isError,
        structuredContent: {
          ok,
          data: { items: [item] },
          error: { code: "INVALID_ARGUMENT" },
        },
      },
    };
    expect(findLeadWriteResult(response)).toBeNull();
  });

  it.each([
    ["structuredContent 缺失", { content: [{ type: "text", text: JSON.stringify({ id: "must-not-pass", dedupStatus: "UNIQUE", duplicateOfLeadId: null, replay: false }) }], isError: false }],
    ["ok 缺失", { isError: false, structuredContent: { data: { items: [{ id: "must-not-pass", dedupStatus: "UNIQUE", duplicateOfLeadId: null, replay: false }] } } }],
    ["data 缺失", { isError: false, structuredContent: { ok: true } }],
    ["字符串 id 缺失", { isError: false, structuredContent: { ok: true, data: { items: [{ dedupStatus: "UNIQUE", duplicateOfLeadId: null, replay: false }] } } }],
  ])("fails closed when a JSON-RPC result has %s", (_label, result) => {
    expect(findLeadWriteResult({ jsonrpc: "2.0", id: "invalid-3013", result })).toBeNull();
  });

  it("redacts API keys and assertions from failure details", () => {
    const message = `Bearer fastgpt-${"a".repeat(40)} eyJ${"a".repeat(24)}.${"b".repeat(24)}.${"c".repeat(24)}`;
    expect(safeLeadE2eFailure(new Error(message))).not.toMatch(/fastgpt-|eyJ/);
  });

  it("summarizes a FastGPT workflow error without leaking credentials", () => {
    const summary = safeLeadE2eResponseSummary({
      choices: [],
      error: `sandbox failed Bearer fastgpt-${"a".repeat(40)}`,
      responseData: [],
    });
    expect(summary).toContain("keys=choices,error,responseData");
    expect(summary).toContain("sandbox failed");
    expect(summary).not.toMatch(/Bearer fastgpt-|fastgpt-a/);
  });
});
