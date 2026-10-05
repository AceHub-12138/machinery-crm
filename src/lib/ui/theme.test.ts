import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyTheme,
  getStoredTheme,
  resolveTheme,
  setStoredTheme,
} from "./theme";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("theme utilities", () => {
  it("falls back to system when storage is empty or invalid", () => {
    const getItem = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce("sepia");
    vi.stubGlobal("window", { localStorage: { getItem } });

    expect(getStoredTheme()).toBe("system");
    expect(getStoredTheme()).toBe("system");
  });

  it("stores the selected mode under dachuan.theme", () => {
    const setItem = vi.fn();
    vi.stubGlobal("window", { localStorage: { setItem } });

    setStoredTheme("dark");

    expect(setItem).toHaveBeenCalledWith("dachuan.theme", "dark");
  });

  it("resolves system mode from the operating-system preference", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal("window", { matchMedia });

    expect(resolveTheme("system")).toBe("dark");
    expect(matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
    expect(resolveTheme("light")).toBe("light");
  });

  it("applies both the data attribute and compatibility class", () => {
    const setAttribute = vi.fn();
    const toggle = vi.fn();
    vi.stubGlobal("window", {
      matchMedia: vi.fn().mockReturnValue({ matches: false }),
    });
    vi.stubGlobal("document", {
      documentElement: { setAttribute, classList: { toggle } },
    });

    applyTheme("system");

    expect(setAttribute).toHaveBeenCalledWith("data-theme", "light");
    expect(toggle).toHaveBeenCalledWith("dark", false);
  });
});
