import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CustomerLifecycleBar } from "./customer-lifecycle-bar";

const source = () =>
  readFileSync(resolve(process.cwd(), "src/components/customers/customer-lifecycle-bar.tsx"), "utf8");

describe("CustomerLifecycleBar", () => {
  it("renders every lifecycle label and the current stage in SSR HTML", () => {
    const html = renderToString(
      <CustomerLifecycleBar customerId="customer-1" status="QUOTED" />,
    );

    for (const label of ["新线索", "已联系", "已报价", "谈判中", "已成交"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('aria-current="step"');
    expect(html).toMatch(/当前阶段：(<!-- -->)?已报价/);
  });

  it.each([
    ["LOST", "已流失"],
    ["INACTIVE", "暂停跟进"],
  ] as const)("renders %s as a separate terminal marker", (status, label) => {
    const html = renderToString(
      <CustomerLifecycleBar customerId="customer-2" status={status} />,
    );

    expect(html).toContain(`data-lifecycle-terminal="${status}"`);
    expect(html).toContain(label);
    expect(html).not.toContain('aria-current="step"');
    expect(html).toContain("transform:scaleX(0)");
  });

  it("animates first entry and real status changes without replaying equal refreshes", () => {
    const component = source();
    const animationBlock = component.slice(
      component.indexOf("useGSAP("),
      component.indexOf("return ("),
    );

    expect(component).toContain('from "@gsap/react"');
    expect(component).toContain("useGSAP(");
    expect(component).toContain("useReducedMotion");
    expect(component).toContain("isReducedMotionPreferred()");
    expect(component).toContain("lifecycleSessionByCustomer");
    expect(component).toContain("previousSession.status === status");
    expect(component).toContain("scaleX: previousSession ? previousProgress : 0");
    expect(component).toContain("scale: 1.06");
    expect(component).toContain("MOTION_STAGGER_INTERVAL");
    expect(component).toContain("MOTION_EASE.enter");
    expect(component).toContain("MOTION_EASE.emphasis");
    expect(animationBlock).not.toMatch(/\b(?:height|left|top|width)\s*:/);
  });

  it("is rendered below the customer detail header using the shared status labels", () => {
    const page = readFileSync(
      resolve(process.cwd(), "src/app/(app)/customers/[id]/page.tsx"),
      "utf8",
    );
    const headerEnd = page.indexOf("</div>", page.indexOf('className="flex items-center gap-4"'));
    const lifecycle = page.indexOf("<CustomerLifecycleBar");
    const tabs = page.indexOf('className="flex gap-1 bg-white');

    expect(page).toContain(
      'import { CustomerLifecycleBar } from "@/components/customers/customer-lifecycle-bar"',
    );
    expect(page).toContain(
      'import { CUSTOMER_STATUS_LABELS } from "@/lib/constants"',
    );
    expect(page).not.toContain("const CUSTOMER_STATUS:");
    expect(lifecycle).toBeGreaterThan(headerEnd);
    expect(lifecycle).toBeLessThan(tabs);
    expect(page).toContain("CUSTOMER_STATUS_LABELS[customer.status]");
  });
});
