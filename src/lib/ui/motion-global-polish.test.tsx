import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("global motion polish contracts", () => {
  it("keeps both pre-hydration scripts in an explicit root head", () => {
    const layout = source("src/app/layout.tsx");
    const head = layout.match(/<head>[\s\S]*?<\/head>/)?.[0] || "";
    const body = layout.match(/<body[\s\S]*?<\/body>/)?.[0] || "";

    expect(head).toContain("themeInitScript");
    expect(head).toContain('id="crypto-randomuuid-polyfill"');
    expect(head).toContain('strategy="beforeInteractive"');
    expect(body).not.toContain("themeInitScript");
    expect(body).not.toContain("crypto-randomuuid-polyfill");
    expect(layout).toContain("suppressHydrationWarning");
    expect(layout).toContain('manifest: "/manifest.webmanifest"');
  });

  it("adds reduced-motion-safe entry animation without delaying dialog close paths", () => {
    const dialog = source("src/components/ui/dialog.tsx");
    const confirmDialog = source("src/components/ui/confirm-dialog.tsx");

    for (const component of [dialog, confirmDialog]) {
      expect(component).toContain('from "@gsap/react"');
      expect(component).toContain("useGSAP(");
      expect(component).toContain("useReducedMotion");
      expect(component).toContain("isReducedMotionPreferred()");
      expect(component).toContain("MOTION_DURATION.normal");
      expect(component).toContain("MOTION_EASE.enter");
      expect(component).toContain("scale: 0.96");
      expect(component).toContain("data-dialog-overlay");
      expect(component).toContain("data-dialog-panel");
      expect(component).not.toContain("setTimeout");
    }

    expect(dialog).toContain("if (!open || !portalTarget) return null");
    expect(dialog).toContain("if (event.target === event.currentTarget) onClose()");
    expect(confirmDialog).toContain("if (!open) return null");
    expect(confirmDialog).toContain("if (event.target === event.currentTarget) onCancel()");
  });

  it("sequences desktop sidebar labels around the existing controlled width transition", () => {
    const sidebar = source("src/components/layout/floating-sidebar.tsx");
    const shell = source("src/components/layout/app-shell.tsx");

    expect(sidebar).toContain('from "@gsap/react"');
    expect(sidebar).toContain("useGSAP(");
    expect(sidebar).toContain("useReducedMotion");
    expect(sidebar).toContain("isReducedMotionPreferred()");
    expect(sidebar).toContain("data-sidebar-label");
    expect(sidebar).toContain('event.propertyName !== "width"');
    expect(sidebar).toContain("MOTION_DURATION.fast");
    expect(sidebar).toContain("MOTION_EASE.exit");
    expect(sidebar).toContain("MOTION_EASE.enter");
    expect(sidebar).toContain("transition-[width] duration-200");
    expect(sidebar).not.toMatch(/gsap\.(?:to|fromTo)\([\s\S]{0,500}\bwidth\s*:/);
    expect(shell).toContain('const SIDEBAR_COLLAPSED_KEY = "dachuan.sidebar.collapsed"');
    expect(shell).toContain("localStorage.setItem(SIDEBAR_COLLAPSED_KEY");
  });

  it("gives enabled native buttons a touch-safe CSS press response", () => {
    const globals = source("src/app/globals.css");
    const pressSelector =
      'button:not(:disabled):not([aria-busy="true"]):active';

    expect(globals).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(globals).toContain(pressSelector);
    expect(globals).toMatch(
      /button:not\(:disabled\):not\(\[aria-busy="true"\]\):active\s*\{[\s\S]*?scale:\s*0\.97/,
    );
    expect(globals).toContain("touch-action: manipulation");
    expect(globals).not.toMatch(/button:active\s*\{/);
  });
});
