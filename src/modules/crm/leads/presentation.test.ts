import { describe, expect, it } from "vitest";
import { buildLeadProfileSections, historicalLeadStatusLabel, safeLeadSourceUrl } from "./presentation";

describe("Lead UI 展示契约", () => {
  it("旧事件空状态显示历史未记录且不推断当前状态", () => {
    expect(historicalLeadStatusLabel(null)).toBe("历史状态未记录");
    expect(historicalLeadStatusLabel("HIGH_INTENT")).toBe("高意向");
  });

  it("来源链接只允许 http 和 https", () => {
    expect(safeLeadSourceUrl("https://example.test/lead")).toBe("https://example.test/lead");
    expect(safeLeadSourceUrl("http://example.test/lead")).toBe("http://example.test/lead");
    expect(safeLeadSourceUrl("javascript:alert(1)")).toBeNull();
    expect(safeLeadSourceUrl("not-a-url")).toBeNull();
  });

  it("把完整结构化画像映射为销售可读区块", () => {
    expect(buildLeadProfileSections({
      summary: "企业正在扩建齿轮生产线。",
      industry: "机械制造",
      intentLevel: "HIGH",
      evidence: ["正在扩产", "出现数控插床采购需求"],
      processNeeds: ["齿轮加工", "插削加工"],
      riskFlags: ["联系方式缺失"],
      salesAdvice: "建议先核实项目预算。",
    })).toEqual([
      { title: "客户概况", values: ["企业正在扩建齿轮生产线。"], kind: "text" },
      { title: "所属行业", values: ["机械制造"], kind: "text" },
      { title: "AI 意向判断", values: ["高意向"], kind: "text" },
      { title: "重点依据", values: ["正在扩产", "出现数控插床采购需求"], kind: "list" },
      { title: "潜在需求", values: ["齿轮加工", "插削加工"], kind: "list" },
      { title: "风险提示", values: ["联系方式缺失"], kind: "list" },
      { title: "销售建议", values: ["建议先核实项目预算。"], kind: "text" },
    ]);
  });

  it("兼容当前生产画像字段并保持 AI 判断与人工状态分离", () => {
    expect(buildLeadProfileSections({
      industry: "金属加工",
      intent: "明确询价",
      scale: "中型制造企业",
      contactability: "电话和邮箱完整",
      confidence: "high",
      reason: "企业公开了设备更新计划。",
      businessScope: ["齿轮制造"],
      purchaseSignals: ["设备询价"],
    })).toEqual([
      { title: "所属行业", values: ["金属加工"], kind: "text" },
      { title: "AI 需求描述", values: ["明确询价"], kind: "text" },
      { title: "企业规模", values: ["中型制造企业"], kind: "text" },
      { title: "联系情况", values: ["电话和邮箱完整"], kind: "text" },
      { title: "AI 判断置信度", values: ["高"], kind: "text" },
      { title: "重点依据", values: ["企业公开了设备更新计划。"], kind: "text" },
      { title: "潜在需求", values: ["齿轮制造", "设备询价"], kind: "list" },
    ]);
  });
});
