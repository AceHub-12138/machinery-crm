import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("sales target dashboard acceptance", () => {
  it("keeps the map and target 1:1 from sm upward and reminders on their own row", () => {
    const dashboard = source("src/app/(app)/dashboard/page.tsx");
    expect(dashboard).toContain("sm:grid-cols-2");
    expect(dashboard).toContain("<SalesTargetCard");
    expect(dashboard).toContain('className="grid gap-6 md:grid-cols-3"');
    expect(dashboard).not.toContain("SalesTargetPlaceholder");
  });

  it("prevents all three map labels from splitting at half width", () => {
    const map = source("src/components/maps/amap-shipment-map.tsx");
    for (const label of ["已解析路径", "发货记录", "省份"]) {
      expect(map).toContain(`className="whitespace-nowrap text-[11px] text-cyan-100/55">${label}`);
    }
  });

  it("uses an enlarged SVG ring with unclipped text and independent local states", () => {
    const card = source("src/components/dashboard/sales-target-card.tsx");
    expect(card).toContain("sm:size-[220px]");
    expect(card).toContain("<svg");
    expect(card).toContain("strokeDashoffset={dashOffset}");
    expect(card).toContain("销售目标暂时无法加载");
    expect(card).toContain("待设置");
    expect(card).toContain("超额完成");
    expect(card).not.toContain("window.location.reload");
  });

  it("applies the dashboard glass variant explicitly without changing SurfaceCard default", () => {
    const surface = source("src/components/ui/surface-card.tsx");
    const crm = source("src/app/(app)/dashboard/page.tsx");
    const erp = source("src/app/(app)/dashboard/erp/page.tsx");
    const css = source("src/app/globals.css");
    expect(surface).toContain('default: "bg-[var(--surface-solid)]"');
    expect(surface).toContain('dashboard: "dashboard-glass backdrop-blur-lg backdrop-saturate-[1.08]"');
    expect(crm).toContain('variant="dashboard"');
    expect(erp).toContain('variant="dashboard"');
    expect(css).toContain("backdrop-filter: blur(16px) saturate(1.08)");
    expect(css).toMatch(/\[data-theme="dark"\][\s\S]*--dashboard-surface:/);
  });

  it("renders the form dialog through a body portal with stable focus management", () => {
    const dialog = source("src/components/ui/dialog.tsx");
    expect(dialog).toContain('import { createPortal } from "react-dom"');
    expect(dialog).toContain("onCloseRef.current = onClose");
    expect(dialog).toContain("return createPortal(");
    expect(dialog).toContain("document.body");
    expect(dialog).not.toContain("}, [onClose, open]);");
  });
});
