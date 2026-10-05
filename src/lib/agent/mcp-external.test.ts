import { describe, expect, it } from "vitest";
import { resolveServerUrl, sanitizeExternalToolName } from "@/lib/agent/mcp-external";

describe("sanitizeExternalToolName", () => {
  it("加 mcp_ 前缀并清理非法字符（OpenAI function name 仅允许字母数字-_）", () => {
    expect(sanitizeExternalToolName("web_search_prime")).toBe("mcp_web_search_prime");
    expect(sanitizeExternalToolName("web-reader")).toBe("mcp_web-reader");
    expect(sanitizeExternalToolName("tyc.mcp.getCompany")).toBe("mcp_tyc_mcp_getCompany");
  });

  it("超长工具名截断到 64 字符", () => {
    const long = "x".repeat(100);
    expect(sanitizeExternalToolName(long)).toHaveLength(64);
    expect(sanitizeExternalToolName(long).startsWith("mcp_")).toBe(true);
  });
});

describe("resolveServerUrl", () => {
  it("替换 {API_KEY} 占位符并对 Key 做编码", () => {
    expect(resolveServerUrl("https://x/mcp?Authorization={API_KEY}", "abc123")).toBe(
      "https://x/mcp?Authorization=abc123",
    );
    expect(resolveServerUrl("https://x/mcp?Authorization={API_KEY}", "a/b+c d")).toBe(
      "https://x/mcp?Authorization=a%2Fb%2Bc%20d",
    );
  });

  it("无占位符的 URL 原样返回（鉴权走 Bearer 头）", () => {
    expect(resolveServerUrl("https://mcp.tianyancha.com/mcp", "tyc-key")).toBe(
      "https://mcp.tianyancha.com/mcp",
    );
  });

  it("占位符存在但缺 Key 时抛错（视为未配置）", () => {
    expect(() => resolveServerUrl("https://x/mcp?Authorization={API_KEY}", null)).toThrow();
    expect(() => resolveServerUrl("https://x/mcp?Authorization={API_KEY}", "")).toThrow();
  });
});
