import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("UI-M7 responsive acceptance contracts", () => {
  it("keeps keyboard focus visible across shell navigation controls", () => {
    const topbar = source("src/components/layout/topbar.tsx");
    const mobileNavigation = source(
      "src/components/layout/mobile-navigation.tsx",
    );
    const userMenu = source("src/components/layout/user-menu.tsx");
    const floatingSidebar = source(
      "src/components/layout/floating-sidebar.tsx",
    );

    expect(topbar.match(/focus-visible:/g)?.length).toBeGreaterThanOrEqual(2);
    expect(mobileNavigation).toContain("focus-visible:outline");
    expect(userMenu.match(/focus-visible:/g)?.length).toBeGreaterThanOrEqual(5);
    expect(floatingSidebar.match(/focus-visible:/g)?.length).toBeGreaterThanOrEqual(
      4,
    );
  });

  it("uses a narrower standing pet at phone width without changing desktop size", () => {
    const floatingPet = source("src/components/dachuan-pet/FloatingPet.tsx");

    expect(floatingPet).toContain("const PET_MOBILE_WIDTH = 112;");
    expect(floatingPet).toContain("const PET_DESKTOP_WIDTH = 152;");
    expect(floatingPet).toContain("w-[112px]");
    expect(floatingPet).toContain("sm:w-[152px]");
  });

  it("keeps keyboard focus inside the open user menu and restores it on close", () => {
    const userMenu = source("src/components/layout/user-menu.tsx");

    expect(userMenu).toContain('event.key !== "Tab"');
    expect(userMenu).toContain("menuRef.current?.querySelectorAll");
    expect(userMenu).toContain("previouslyFocused?.focus()");
  });

  it("keeps the sidebar glass visible against a dedicated background glow", () => {
    const shell = source("src/components/layout/app-shell.tsx");
    const sidebar = source("src/components/layout/floating-sidebar.tsx");
    const globals = source("src/app/globals.css");

    expect(shell).toContain("sidebar-backdrop-glow");
    expect(shell).not.toContain("overflow-x-clip");
    expect(sidebar).toContain("sidebar-glass");
    expect(sidebar).toContain("sidebar-glass-panel");
    expect(globals).toContain("backdrop-filter: blur(22px) saturate(135%)");
  });
});
