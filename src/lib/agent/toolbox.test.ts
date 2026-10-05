import { describe, expect, it } from "vitest";
import { MCP_TOOL_NAMES } from "@/lib/mcp/tools";
import {
  buildXiaochuanToolSpecs,
  getXiaochuanToolSchema,
  XIAOCHUAN_ALLOWED_TOOLS,
} from "@/lib/agent/toolbox";
import { KNOWLEDGE_TOOL_DEFINITIONS } from "@/lib/agent/knowledge/tools";
import { CALCULATOR_TOOL_DEFINITIONS } from "@/lib/agent/tools/calculator";

describe("XIAOCHUAN_ALLOWED_TOOLS", () => {
  it("= MCP 业务工具全集（24 个）+ 内置知识工具（3 个）+ 内置计算工具（2 个），不含身份工具", () => {
    expect(MCP_TOOL_NAMES).not.toContain("dachuan_identity_who_am_i");
    expect(XIAOCHUAN_ALLOWED_TOOLS).toHaveLength(
      MCP_TOOL_NAMES.length + KNOWLEDGE_TOOL_DEFINITIONS.length + CALCULATOR_TOOL_DEFINITIONS.length,
    );
    expect(XIAOCHUAN_ALLOWED_TOOLS).toHaveLength(29);
    expect(XIAOCHUAN_ALLOWED_TOOLS).not.toContain("dachuan_identity_who_am_i");
    for (const name of MCP_ALLOWED_TOOLS_ONLY(XIAOCHUAN_ALLOWED_TOOLS)) {
      expect(MCP_TOOL_NAMES).toContain(name);
    }
  });

  it("包含三个内置知识工具与两个内置计算工具，全员可查、白名单外工具仍不出现", () => {
    expect(XIAOCHUAN_ALLOWED_TOOLS).toContain("dachuan_knowledge_machine_search");
    expect(XIAOCHUAN_ALLOWED_TOOLS).toContain("dachuan_knowledge_process_rules");
    expect(XIAOCHUAN_ALLOWED_TOOLS).toContain("dachuan_knowledge_nc_program");
    expect(XIAOCHUAN_ALLOWED_TOOLS).toContain("dachuan_calc_expression");
    expect(XIAOCHUAN_ALLOWED_TOOLS).toContain("dachuan_calc_part_weight");
    expect(XIAOCHUAN_ALLOWED_TOOLS.every((name) => !name.includes("upsert"))).toBe(true);
    expect(XIAOCHUAN_ALLOWED_TOOLS.every((name) => !name.includes("write"))).toBe(true);
  });
});

/** 从白名单里滤掉内置工具（知识 + 计算），剩下的应全部来自 MCP 业务清单 */
function MCP_ALLOWED_TOOLS_ONLY(names: readonly string[]) {
  const builtinNames = [
    ...KNOWLEDGE_TOOL_DEFINITIONS.map((definition) => definition.name),
    ...CALCULATOR_TOOL_DEFINITIONS.map((definition) => definition.name),
  ];
  return names.filter((name) => !builtinNames.includes(name));
}

describe("buildXiaochuanToolSpecs", () => {
  it("超级管理员可见全部 24 个工具，且参数是合法 JSON Schema", () => {
    const specs = buildXiaochuanToolSpecs("SUPER_ADMIN");
    expect(specs).toHaveLength(XIAOCHUAN_ALLOWED_TOOLS.length);
    for (const spec of specs) {
      expect(spec.type).toBe("function");
      expect(spec.function.name).toBeTruthy();
      expect(spec.function.description).toBeTruthy();
      expect(spec.function.parameters).toMatchObject({ type: "object" });
      expect(spec.function.parameters.additionalProperties).toBe(false);
    }
  });

  it("销售看不到 AI 线索池工具，但能看到客户工具", () => {
    const names = buildXiaochuanToolSpecs("SALES").map((spec) => spec.function.name);
    expect(names).not.toContain("lead_list");
    expect(names).not.toContain("lead_stats");
    expect(names).toContain("crm_customers_list");
    expect(names).toContain("crm_contracts_list");
  });

  it("采购与仓库看不到 CRM 客户工具，但能看到库存工具", () => {
    for (const role of ["PURCHASE", "WAREHOUSE"] as const) {
      const names = buildXiaochuanToolSpecs(role).map((spec) => spec.function.name);
      expect(names).not.toContain("crm_customers_list");
      expect(names).toContain("erp_inventory_list");
    }
  });

  it("供应商详情只下发给有权角色（与 MCP 矩阵一致）", () => {
    const admin = buildXiaochuanToolSpecs("SUPER_ADMIN").map((spec) => spec.function.name);
    const warehouse = buildXiaochuanToolSpecs("WAREHOUSE").map((spec) => spec.function.name);
    expect(admin).toContain("erp_supplier_get");
    expect(warehouse).not.toContain("erp_supplier_get");
  });

  it("知识工具与计算工具对所有角色都下发（不含业务敏感数据）", () => {
    for (const role of ["SUPER_ADMIN", "SALES", "FOREIGN_TRADE", "PURCHASE", "WAREHOUSE"] as const) {
      const names = buildXiaochuanToolSpecs(role).map((spec) => spec.function.name);
      expect(names).toContain("dachuan_knowledge_machine_search");
      expect(names).toContain("dachuan_knowledge_process_rules");
      expect(names).toContain("dachuan_knowledge_nc_program");
      expect(names).toContain("dachuan_calc_expression");
      expect(names).toContain("dachuan_calc_part_weight");
    }
  });
});

describe("getXiaochuanToolSchema", () => {
  it("白名单内工具返回 schema，未知工具返回 null", () => {
    expect(getXiaochuanToolSchema("crm_contracts_list")).not.toBeNull();
    expect(getXiaochuanToolSchema("delete_all_data")).toBeNull();
  });

  it("身份工具不在小川工具箱内", () => {
    expect(getXiaochuanToolSchema("dachuan_identity_who_am_i")).toBeNull();
  });

  it("知识工具能取到 Zod schema", () => {
    expect(getXiaochuanToolSchema("dachuan_knowledge_machine_search")).not.toBeNull();
    expect(getXiaochuanToolSchema("dachuan_knowledge_nc_program")).not.toBeNull();
  });

  it("计算工具能取到 Zod schema", () => {
    expect(getXiaochuanToolSchema("dachuan_calc_expression")).not.toBeNull();
    expect(getXiaochuanToolSchema("dachuan_calc_part_weight")).not.toBeNull();
  });
});

describe("buildXiaochuanToolSpecs (AGENT_ACCOUNT)", () => {
  it("Agent 独立账号只收到 3 个知识工具 + 2 个计算工具，业务工具一个都不下发", () => {
    const specs = buildXiaochuanToolSpecs("AGENT_ACCOUNT");
    expect(specs).toHaveLength(5);
    const names = specs.map((spec) => spec.function.name);
    expect(names.every((name) => name.startsWith("dachuan_knowledge_") || name.startsWith("dachuan_calc_"))).toBe(true);
  });
});
