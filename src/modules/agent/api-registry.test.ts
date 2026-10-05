import { describe, expect, it } from "vitest";
import { API_REGISTRY } from "./api-registry";
import { MCP_TOOL_CANDIDATES } from "./mcp-tool-candidates";
import { DomainError, isDomainError } from "@/modules/shared/domain-error";

describe("阶段 2 API 与 MCP 注册表", () => {
  it("登记 CRM、ERP、SYSTEM、AGENT 四个领域，且不可由 Agent 直接暴露", () => {
    expect(new Set(API_REGISTRY.map((entry) => entry.domain))).toEqual(new Set(["CRM", "ERP", "SYSTEM", "AGENT"]));
    expect(API_REGISTRY.every((entry) => entry.agentExposable === false)).toBe(true);
  });

  it("MCP 候选仅为超管只读工具，并具备完整审计映射", () => {
    for (const candidate of MCP_TOOL_CANDIDATES) {
      expect(candidate.allowedRoles).toEqual(["SUPER_ADMIN"]);
      expect(candidate.readOnly).toBe(true);
      expect(candidate.auditAction).toMatch(/^MCP_READ_/);
      expect(candidate.inputSchema).not.toBe("");
      expect(candidate.outputSchema).not.toBe("");
    }
  });

  it("领域错误可由兼容路由安全翻译", () => {
    const error = new DomainError("无权限", 403);
    expect(isDomainError(error)).toBe(true);
    expect(error.status).toBe(403);
  });
});
