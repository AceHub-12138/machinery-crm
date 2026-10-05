import { describe, expect, it } from "vitest";
import { leadRoutingAuditAction, leadRoutingOutcome, resolveLeadAssignee } from "./lead-routing";

describe("Lead 区域自动分配", () => {
  it("明确省市只匹配现有 CRM territories 中唯一启用的国内销售", () => {
    expect(resolveLeadAssignee({ province: "山东省", city: "济南市" }, [
      { id: "sales-east", role: "SALES", isActive: true, territories: [{ province: "山东省", cities: ["济南市"] }] },
      { id: "sales-south", role: "SALES", isActive: true, territories: [{ province: "广东省", cities: [] }] },
      { id: "foreign", role: "FOREIGN_TRADE", isActive: true, territories: [{ province: "国外", cities: [] }] },
    ])).toEqual({
      assignedUserId: "sales-east",
      reason: null,
      province: "山东省",
      city: "济南市",
    });
  });

  it.each([
    ["江苏省 / 无锡市", { province: "江苏省", city: "无锡市" }],
    ["江苏省 / city 为空", { province: "江苏省" }],
  ])("%s 匹配负责整个江苏省的唯一销售", (_label, profile) => {
    expect(resolveLeadAssignee(profile, [
      { id: "sales-jiangsu", role: "SALES", isActive: true, territories: [{ province: "江苏省", cities: [] }] },
    ])).toMatchObject({ assignedUserId: "sales-jiangsu", reason: null, province: "江苏省" });
  });

  it("缺少可信结构化地区时保持未指派", () => {
    expect(resolveLeadAssignee({ industry: "机械制造" }, [])).toEqual({
      assignedUserId: null,
      reason: "REGION_UNRESOLVED",
      province: null,
      city: null,
    });
  });

  it("明确地区没有负责人时进入待人工分配", () => {
    expect(resolveLeadAssignee({ province: "山东省", city: "济南市" }, [])).toMatchObject({
      assignedUserId: null,
      reason: "NO_MATCHING_ASSIGNEE",
    });
  });

  it("重叠 territories 不随机选择负责人", () => {
    expect(resolveLeadAssignee({ province: "山东省" }, [
      { id: "sales-1", role: "SALES", isActive: true, territories: [{ province: "山东省", cities: [] }] },
      { id: "sales-2", role: "SALES", isActive: true, territories: [{ province: "山东省", cities: [] }] },
    ])).toMatchObject({ assignedUserId: null, reason: "MULTIPLE_MATCHING_ASSIGNEES" });
  });

  it("非法省市组合不会靠公司名或关键词猜测", () => {
    expect(resolveLeadAssignee({ province: "山东省", city: "广州市" }, [
      { id: "sales-1", role: "SALES", isActive: true, territories: [{ province: "山东省", cities: [] }] },
    ])).toMatchObject({ assignedUserId: null, reason: "REGION_UNRESOLVED" });
  });

  it("江苏省 / 广州市 明确返回 REGION_UNRESOLVED", () => {
    expect(resolveLeadAssignee({ province: "江苏省", city: "广州市" }, [
      { id: "sales-jiangsu", role: "SALES", isActive: true, territories: [{ province: "江苏省", cities: [] }] },
    ])).toMatchObject({ assignedUserId: null, reason: "REGION_UNRESOLVED" });
  });

  it("国外只匹配 FOREIGN_TRADE，不扩大国内销售口径", () => {
    expect(resolveLeadAssignee({ province: "国外" }, [
      { id: "sales-1", role: "SALES", isActive: true, territories: [{ province: "国外", cities: [] }] },
      { id: "foreign-1", role: "FOREIGN_TRADE", isActive: true, territories: [{ province: "山东省", cities: [] }] },
    ])).toMatchObject({ assignedUserId: "foreign-1", reason: null });
  });

  it("审计 action 保留 old/new 或自动失败原因", () => {
    expect(leadRoutingAuditAction({ assignedUserId: "sales-1", reason: null, province: "山东省", city: null }))
      .toBe("AUTO_ASSIGN|old=-|new=sales-1");
    expect(leadRoutingAuditAction({ assignedUserId: null, reason: "REGION_UNRESOLVED", province: null, city: null }))
      .toBe("AUTO_ASSIGN_FAILED|old=-|new=-|reason=REGION_UNRESOLVED");
  });

  it.each([
    [{ assignedUserId: "sales-1", reason: null, province: "江苏省", city: null }, "ASSIGNED"],
    [{ assignedUserId: null, reason: "REGION_UNRESOLVED", province: null, city: null }, "REGION_UNRESOLVED"],
    [{ assignedUserId: null, reason: "NO_MATCHING_ASSIGNEE", province: "江苏省", city: null }, "NO_MATCHING_ASSIGNEE"],
    [{ assignedUserId: null, reason: "MULTIPLE_MATCHING_ASSIGNEES", province: "江苏省", city: null }, "MULTIPLE_MATCHING_ASSIGNEES"],
    [{ assignedUserId: null, reason: "ROUTING_UNAVAILABLE", province: "江苏省", city: null }, "ROUTING_UNAVAILABLE"],
  ] as const)("maps routing result to independent outcome %s", (routing, expected) => {
    expect(leadRoutingOutcome(routing)).toBe(expected);
  });
});
