import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("ERP kit-check motion contracts", () => {
  it("shows a disabled checking state and arms row replay only after a fresh check succeeds", () => {
    const detailPage = source("src/app/(app)/erp/production-orders/[id]/page.tsx");

    expect(detailPage).toContain("const [checking, setChecking] = useState(false)");
    expect(detailPage).toContain('disabled={checking}');
    expect(detailPage).toContain('{checking ? "检查中…" : "执行齐套检查"}');
    expect(detailPage).toMatch(
      /const kitCheck = async \(\) =>[\s\S]*?setChecking\(true\)[\s\S]*?method: "POST"[\s\S]*?await load\(\)[\s\S]*?setKitCheckReplayRun\(\(current\) => current \+ 1\)[\s\S]*?setChecking\(false\)/,
    );
  });

  it("replays at most 50 fresh result rows within the motion budget and respects reduced motion", () => {
    const detailPage = source("src/app/(app)/erp/production-orders/[id]/page.tsx");

    expect(detailPage).toContain('from "@gsap/react"');
    expect(detailPage).toContain("useGSAP(");
    expect(detailPage).toContain("useReducedMotion");
    expect(detailPage).toContain("isReducedMotionPreferred()");
    expect(detailPage).toContain("const KIT_CHECK_REPLAY_LIMIT = 50");
    expect(detailPage).toContain("const KIT_CHECK_ROW_STAGGER = 0.08");
    expect(detailPage).toContain("const KIT_CHECK_REPLAY_MAX_DURATION = 1.5");
    expect(detailPage).toContain("const KIT_CHECK_ROW_DURATION = MOTION_DURATION.normal");
    expect(detailPage).toContain("rows.length > KIT_CHECK_REPLAY_LIMIT");
    expect(detailPage).toContain("data-kit-check-row");
    expect(detailPage).toMatch(
      /Math\.min\([\s\S]*?KIT_CHECK_ROW_STAGGER[\s\S]*?KIT_CHECK_REPLAY_MAX_DURATION - KIT_CHECK_ROW_DURATION[\s\S]*?rows\.length - 1/,
    );
    expect(detailPage).toMatch(
      /gsap\.fromTo\([\s\S]*?rows[\s\S]*?opacity: 0[\s\S]*?y: 12[\s\S]*?duration: KIT_CHECK_ROW_DURATION[\s\S]*?ease: MOTION_EASE\.enter[\s\S]*?opacity: 1[\s\S]*?y: 0/,
    );

    const replayBlock = detailPage.slice(
      detailPage.indexOf("useGSAP("),
      detailPage.indexOf("const persistDraft"),
    );
    expect(replayBlock).not.toMatch(/\b(?:background|color|height|left|top|width)\s*:/);
  });

  it("gives existing production-order results one page entrance without arming row replay", () => {
    const detailPage = source("src/app/(app)/erp/production-orders/[id]/page.tsx");

    expect(detailPage).toContain('from "@/components/motion/MotionPage"');
    expect(detailPage.match(/<MotionPage/g)).toHaveLength(1);
    expect(detailPage).toContain('<MotionPage className="space-y-4">');
    expect(detailPage).not.toMatch(/<MotionPage[^>]*\bkey=/);
    expect(detailPage).toContain("dependencies: [kitCheckReplayRun, reducedMotion]");
  });

  it("fades the purchase action highlight once after demand generation succeeds", () => {
    const detailPage = source("src/app/(app)/erp/production-orders/[id]/page.tsx");

    expect(detailPage).toContain("const [purchaseHighlightRun, setPurchaseHighlightRun] = useState(0)");
    expect(detailPage).toContain("handledPurchaseHighlightRunRef");
    expect(detailPage.match(/data-assignment-highlight=/g)).toHaveLength(1);
    expect(detailPage).toContain('data-assignment-highlight="purchase-demand"');
    expect(detailPage).toMatch(
      /purchase-demands[\s\S]*?setPurchaseHighlightRun\(\(current\) => current \+ 1\)/,
    );
    expect(detailPage).toMatch(
      /const highlightFinished = new Promise<boolean>[\s\S]*?setPurchaseHighlightRun\(\(current\) => current \+ 1\)[\s\S]*?const highlightCompleted = await highlightFinished[\s\S]*?if \(!highlightCompleted\) return;[\s\S]*?window\.confirm/,
    );
    expect(detailPage).toMatch(
      /gsap\.fromTo\([\s\S]*?highlight[\s\S]*?opacity: 1[\s\S]*?duration: MOTION_DURATION\.process[\s\S]*?ease: MOTION_EASE\.decel[\s\S]*?opacity: 0/,
    );
    expect(detailPage).toContain("finishPurchaseHighlight");
    expect(detailPage).toContain("finishPurchaseHighlight(false)");
  });

  it("adds one page entrance to the result list without animating table rows", () => {
    const resultPage = source("src/app/(app)/erp/kit-check-results/page.tsx");

    expect(resultPage).toContain('from "@/components/motion/MotionPage"');
    expect(resultPage.match(/<MotionPage/g)).toHaveLength(1);
    expect(resultPage).not.toContain("StaggerContainer");
    expect(resultPage).not.toMatch(/<(?:tbody|tr)[^>]*data-.*motion/);
    expect(resultPage).not.toMatch(/<MotionPage[^>]*\bkey=/);
  });

  it("staggers ERP and cockpit metric grids without replay keys", () => {
    const erpDashboard = source("src/app/(app)/dashboard/erp/page.tsx");
    const adminCockpit = source("src/app/(app)/admin/cockpit/page.tsx");

    for (const page of [erpDashboard, adminCockpit]) {
      expect(page).toContain('from "@/components/motion/StaggerContainer"');
      expect(page).toContain("delay={MOTION_SEQUENCE.kpi}");
      expect(page).not.toMatch(/<StaggerContainer[^>]*\bkey=/);
    }
    expect(erpDashboard.match(/<StaggerContainer/g)).toHaveLength(1);
    expect(adminCockpit.match(/<StaggerContainer/g)).toHaveLength(2);
    expect(erpDashboard.match(/\banimateNumber\b/g)).toHaveLength(4);
    expect(adminCockpit.match(/\banimateNumber\b/g)).toHaveLength(3);
  });
});
