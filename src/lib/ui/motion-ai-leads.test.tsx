import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LeadDetailClient } from "@/components/leads/lead-detail-client";
import { LeadListClient } from "@/components/leads/lead-list-client";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("AI 线索模块动效契约", () => {
  it("详情页复用统一进场组件，并且只滚动已有的 AI 评分", () => {
    const detail = source("src/components/leads/lead-detail-client.tsx");

    expect(detail).toContain('from "@/components/motion/MotionPage"');
    expect(detail).toContain('from "@/components/motion/StaggerContainer"');
    expect(detail).toContain('from "@/components/motion/AnimatedNumber"');
    expect(detail).toContain("<MotionPage");
    expect(detail.match(/<StaggerContainer/g)).toHaveLength(2);
    expect(detail).toContain(
      'value={lead.aiScore == null ? "未评分" : <AnimatedNumber value={lead.aiScore} />}',
    );
  });

  it("详情页负责人更新后用受控透明度高亮反馈", () => {
    const detail = source("src/components/leads/lead-detail-client.tsx");

    expect(detail).toContain('from "@gsap/react"');
    expect(detail).toContain('from "gsap"');
    expect(detail).toContain("useGSAP(");
    expect(detail).toContain("useReducedMotion");
    expect(detail).toContain("isReducedMotionPreferred");
    expect(detail).toContain("assignmentHighlightRun");
    expect(detail).toContain("assignmentHighlightRun === handledAssignmentHighlightRunRef.current");
    expect(detail).toContain("setAssignmentHighlightRun((current) => current + 1)");
    expect(detail).toContain("data-assignment-highlight");
    expect(detail).toContain("pointer-events-none");
    expect(detail).toContain("duration: MOTION_DURATION.process");
    expect(detail).toContain("dependencies: [assignmentHighlightRun, reducedMotion]");
    expect(detail).toMatch(/gsap\.fromTo\([\s\S]*?\{ opacity: 1 \}[\s\S]*?opacity: 0/);
    expect(detail).not.toMatch(/\bbackgroundColor\s*:/);
  });

  it("列表页只有一个页面级进场，表格和状态徽章不参与编排", () => {
    const list = source("src/components/leads/lead-list-client.tsx");

    expect(list).toContain('from "@/components/motion/MotionPage"');
    expect(list.match(/<MotionPage/g)).toHaveLength(1);
    expect(list).not.toContain("StaggerContainer");
    expect(list).not.toContain("AnimatedNumber");
    expect(list).toContain("<table");
    expect(list).toContain("<LeadStatusBadge status={lead.reviewStatus} />");

    const tableBody = list.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0] ?? "";
    expect(tableBody).not.toContain("MotionPage");
    expect(tableBody).not.toContain("StaggerContainer");
    expect(tableBody).not.toContain("gsap.");
    expect(list).not.toMatch(/querySelectorAll(?:<[^>]+>)?\(\s*["']tr["']/);
  });

  it("批量指派只高亮成功行，并保持复选框业务状态独立", () => {
    const list = source("src/components/leads/lead-list-client.tsx");

    expect(list).toContain('from "@gsap/react"');
    expect(list).toContain('from "gsap"');
    expect(list).toContain("useGSAP(");
    expect(list).toContain("useReducedMotion");
    expect(list).toContain("isReducedMotionPreferred");
    expect(list).toContain("const assignedLeadIds = selectedLeads.map((lead) => lead.id)");
    expect(list).toContain("leadIds: assignedLeadIds");
    expect(list).toContain("setHighlightedLeadIds(new Set(assignedLeadIds))");
    expect(list).toContain("setAssignmentHighlightRun((current) => current + 1)");
    expect(list).toContain("assignmentHighlightRun === handledAssignmentHighlightRunRef.current");
    expect(list).toContain("data-assignment-highlight={lead.id}");
    expect(list).toContain("pointer-events-none");
    expect(list).toContain("relative isolate border-b");
    expect(list).toContain("absolute inset-0 -z-10");
    expect(list).toContain("duration: MOTION_DURATION.process");
    expect(list).toContain("dependencies: [assignmentHighlightRun, reducedMotion]");
    expect(list).toMatch(/gsap\.fromTo\([\s\S]*?\{ opacity: 1 \}[\s\S]*?opacity: 0/);
    expect(list).not.toMatch(/\bbackgroundColor\s*:/);
    expect(list).toContain("checked={selectedLeadIds.has(lead.id)}");
    expect(list).toContain("onChange={() => toggleLead(lead.id)}");
  });

  it("SSR 首帧直接可见，进场和高亮不依赖刷新后的业务数据", () => {
    const detailMarkup = renderToString(<LeadDetailClient canAssign leadId="lead-1" />);
    const listMarkup = renderToString(<LeadListClient canFilterAssignee />);

    expect(detailMarkup).toContain("animate-pulse");
    expect(listMarkup).toContain("AI 线索池");
    expect(detailMarkup).not.toMatch(/style="[^"]*(?:opacity:\s*0|transform)/);
    expect(listMarkup).not.toMatch(/style="[^"]*(?:opacity:\s*0|transform)/);

    for (const component of [
      source("src/components/leads/lead-detail-client.tsx"),
      source("src/components/leads/lead-list-client.tsx"),
    ]) {
      expect(component).not.toMatch(/<(?:MotionPage|StaggerContainer)[^>]*\bkey=/);
      expect(component).not.toMatch(
        /dependencies:\s*\[[^\]]*\b(?:lead|items|loading|page|searchKeyword)\b/,
      );
    }
  });
});
