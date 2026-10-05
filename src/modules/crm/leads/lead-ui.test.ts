import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("AI 线索池 UI 契约", () => {
  it("新入口同时进入实际侧栏和兼容侧栏", () => {
    for (const path of [
      "src/components/layout/floating-sidebar.tsx",
      "src/components/layout/sidebar.tsx",
    ]) {
      const sidebar = source(path);
      expect(sidebar).toContain('{ href: "/leads", label: "AI 线索池" }');
      expect(sidebar).toContain('roles: ["SUPER_ADMIN", "SALES", "FOREIGN_TRADE"]');
    }
  });

  it("列表展示 5B 要求字段和单条查看入口", () => {
    const list = source("src/components/leads/lead-list-client.tsx");
    for (const label of ["公司 / 联系人", "联系方式", "AI 评分", "反馈状态", "获客关键词", "来源", "指派人", "创建时间", "版本"]) {
      expect(list).toContain(label);
    }
    expect(list).not.toContain("AI Score");
    expect(list).toContain('min-w-[1530px]');
    expect(list).toContain("whitespace-nowrap");
    expect(list).toContain('max-w-[220px] truncate');
    expect(list).toContain("loadLeadAssignees");
    expect(list).toContain("canFilterAssignee &&");
    expect(list).toContain("href={`/leads/${lead.id}`}");
    expect(list).toContain("全选当前页");
    expect(list).toContain("批量指派销售");
    expect(list).toContain("批量标记无效");
    expect(list).toContain("expectedFeedbackVersion: lead.feedbackVersion");
    expect(list).toContain("resetSelectionForQuery");
    expect(list).toContain("disabled={loading || operating");
    expect(list).toContain('params.set("excludeInvalid", "1")');
  });

  it("详情展示画像、模型、历史事件并提交当前版本", () => {
    const detail = source("src/components/leads/lead-detail-client.tsx");
    for (const text of ["AI 画像", "模型版本", "提取器版本", "历史反馈", "reviewReasonCode", "reviewedByUser", "reviewedAt"]) {
      expect(detail).toContain(text);
    }
    expect(detail).toContain("historicalLeadStatusLabel(feedbackEvent.reviewStatus)");
    expect(detail).toContain("expectedFeedbackVersion: lead.feedbackVersion");
    expect(detail).toContain("submitLeadFeedbackAndRefresh");
    expect(detail).toContain("LeadProfilePresentation");
    expect(detail).toContain('label="AI 评分"');
    expect(detail).toContain('label="反馈版本"');
    expect(detail).not.toContain('label="feedbackVersion"');
    expect(detail).not.toContain("JSON.stringify(lead.profile");
    expect(detail).not.toContain("<pre");
    expect(detail).not.toContain("/api/customers");
    expect(detail).not.toContain("转换客户");
    expect(detail).not.toContain("KPI");
    expect(detail).toContain("分配 / 改派负责人");
    expect(detail).toContain("assignLeadsAndRefresh");
  });

  it("列表和详情页面都执行数据库刷新后的服务端角色门禁", () => {
    expect(source("src/app/(app)/leads/page.tsx")).toContain("requireLeadPoolPageUser");
    const detailPage = source("src/app/(app)/leads/[id]/page.tsx");
    expect(detailPage).toContain("requireLeadPoolPageUser");
    expect(detailPage).toContain('canAssign={user.role === "SUPER_ADMIN"}');
  });
});
