import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { MetricCard } from "@/components/ui/metric-card";
import { MOTION_DURATION, MOTION_EASE } from "@/lib/motion/config";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Dashboard motion foundation", () => {
  it("centralizes the approved durations and business-safe easing curves", () => {
    expect(MOTION_DURATION).toEqual({
      instant: 0.1,
      fast: 0.15,
      normal: 0.3,
      slow: 0.45,
      process: 0.6,
      enter: 0.6,
      numberRoll: 1.1,
    });
    expect(MOTION_EASE).toEqual({
      enter: "motionEnterSpring",
      exit: "power2.in",
      decel: "expo.out",
      emphasis: "back.out(1.2)",
    });

    const config = source("src/lib/motion/config.ts");
    expect(config).not.toMatch(/elastic|bounce/i);
  });

  it("renders the final formatted number during SSR", () => {
    const number = renderToString(<AnimatedNumber value={1234567} />);
    const money = renderToString(
      <AnimatedNumber
        format={(value) => `¥${value.toLocaleString("zh-CN")}`}
        precision={2}
        value={1234567.89}
      />,
    );

    expect(number).toContain("1,234,567");
    expect(money).toContain("¥1,234,567.89");
  });

  it("keeps MetricCard number animation opt-in", () => {
    const staticCard = renderToString(<MetricCard number={1234} title="静态指标" />);
    const animatedCard = renderToString(
      <MetricCard animateNumber number={1234} title="动画指标" />,
    );

    expect(staticCard).toContain("1234");
    expect(staticCard).not.toContain("data-animated-number");
    expect(animatedCard).toContain("data-animated-number");
    expect(animatedCard).toContain("1,234");
  });

  it("uses useGSAP lifecycle management and reduced-motion in every motion component", () => {
    for (const file of ["MotionPage.tsx", "AnimatedNumber.tsx", "StaggerContainer.tsx"]) {
      const component = source(`src/components/motion/${file}`);
      expect(component).toContain('from "@gsap/react"');
      expect(component).toContain("useGSAP(");
      expect(component).toContain("useReducedMotion");
      expect(component).not.toMatch(/useEffect[\s\S]*gsap\./);
    }

    const hook = source("src/hooks/useReducedMotion.ts");
    expect(hook).toContain("prefers-reduced-motion: reduce");
    expect(hook).toContain("useSyncExternalStore");
  });

  it("limits GSAP properties to opacity and transforms", () => {
    const components = ["MotionPage.tsx", "AnimatedNumber.tsx", "StaggerContainer.tsx"]
      .map((file) => source(`src/components/motion/${file}`))
      .join("\n");

    expect(components).not.toMatch(/\b(?:width|height|left|top)\s*:/);
    expect(components).not.toMatch(/elastic|bounce/i);
  });

  it("enables approved dashboard motion and leaves fallback states outside orchestration", () => {
    const dashboard = source("src/app/(app)/dashboard/page.tsx");
    const erpDashboard = source("src/app/(app)/dashboard/erp/page.tsx");
    const adminCockpit = source("src/app/(app)/admin/cockpit/page.tsx");

    expect(dashboard).toContain("<MotionPage");
    expect(dashboard).toContain("<StaggerContainer");
    expect(dashboard).toContain("animateNumber");
    expect(dashboard).toContain("<DashboardMotionContent");
    expect(dashboard).toContain('enabled={Boolean(data)}');
    expect(dashboard).toContain("delay={MOTION_SEQUENCE.kpi}");
    expect(dashboard).toContain("delay={MOTION_SEQUENCE.rest} offset={0}");
    expect(dashboard).toContain("<DashboardLoadingState />");
    expect(dashboard).toContain("<DashboardErrorState");
    expect(dashboard).toMatch(
      /<DashboardMapErrorBoundary[\s\S]*?<MotionPage delay=\{MOTION_SEQUENCE\.rest\} offset=\{0\}>[\s\S]*?<AmapShipmentMap/,
    );
    expect(erpDashboard).toContain("animateNumber");
    expect(adminCockpit).toContain("animateNumber");
  });
});
