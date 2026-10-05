import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_TOOL_DEFINITIONS,
  getKnowledgeToolDefinition,
  isKnowledgeTool,
} from "@/lib/agent/knowledge/tools";
import { XIAOCHUAN_ALLOWED_TOOLS } from "@/lib/agent/toolbox";

describe("知识工具定义", () => {
  it("三个知识工具全部在小川白名单内", () => {
    for (const definition of KNOWLEDGE_TOOL_DEFINITIONS) {
      expect(isKnowledgeTool(definition.name)).toBe(true);
      expect(XIAOCHUAN_ALLOWED_TOOLS).toContain(definition.name);
    }
  });

  it("按名称取定义，未知工具返回 null", () => {
    expect(getKnowledgeToolDefinition("dachuan_knowledge_machine_search")?.title).toBe("查询机型能力参数");
    expect(getKnowledgeToolDefinition("crm_products_list")).toBeNull();
  });

  it("所有 schema 都是 strict object：多余键直接报错", () => {
    for (const definition of KNOWLEDGE_TOOL_DEFINITIONS) {
      const unknownKey = definition.schema.safeParse({ totally_unknown_key: 1 });
      expect(unknownKey.success).toBe(false);
    }
  });

  it("机型查询允许空参数（全量清单），数值参数合法", () => {
    const definition = getKnowledgeToolDefinition("dachuan_knowledge_machine_search")!;
    expect(definition.schema.safeParse({}).success).toBe(true);
    expect(definition.schema.safeParse({ minStrokeLengthMm: 320, limit: 30 }).success).toBe(true);
    expect(definition.schema.safeParse({ limit: 0 }).success).toBe(false);
    expect(definition.schema.safeParse({ limit: 1.5 }).success).toBe(false);
  });

  it("程序模板查询的 system 是三系统枚举", () => {
    const definition = getKnowledgeToolDefinition("dachuan_knowledge_nc_program")!;
    expect(definition.schema.safeParse({ system: "GSK" }).success).toBe(true);
    expect(definition.schema.safeParse({ system: "KND" }).success).toBe(true);
    expect(definition.schema.safeParse({ system: "SIEMENS" }).success).toBe(true);
    expect(definition.schema.safeParse({ system: "FANUC" }).success).toBe(false);
    expect(definition.schema.safeParse({}).success).toBe(false);
  });
});
