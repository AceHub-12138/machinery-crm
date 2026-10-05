export type ThemeMode = "system" | "light" | "dark";

type ResolvedTheme = Exclude<ThemeMode, "system">;

const THEME_STORAGE_KEY = "dachuan.theme";

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(storedTheme) ? storedTheme : "system";
  } catch {
    return "system";
  }
}

export function setStoredTheme(mode: ThemeMode): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== "system") return mode;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;

  const resolvedTheme = resolveTheme(mode);
  document.documentElement.setAttribute("data-theme", resolvedTheme);
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
}
