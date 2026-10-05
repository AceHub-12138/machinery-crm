import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 大屏组件层边界守卫（静态源码扫描）。
 *
 * 大屏组件只允许依赖公开白名单 payload（PublicSalesScreenPayload）：
 *  - 不得迁回视觉仓库旧 DTO（ScreenCrmPayload / CrmDashboardResponse / SalesTargetResponse）；
 *  - 不得出现客户身份字段、倍率、地图密钥或原始 CRM API 地址；
 *  - 总量只能来自 delivery.summary 等显式字段，禁止从样本数组 length 推导；
 *  - 字号一律走大屏专用工具类（.screen-text-*），不许裸 px，也不许把字号令牌
 *    写成任意值 —— Tailwind 4 会把「text + 方括号 + var(--fs-x)」当成颜色，
 *    65 处字号静默失效的教训见视觉仓库 docs/screen-design-spec.md 第 2 节；
 *  - 样式全部以 .sales-screen-root 作用域开始，@keyframes 以 screen- 前缀命名；
 *  - 无限动画预算 ≤ 8，且全部响应 prefers-reduced-motion；
 *  - 金额读数必须带 .money / .nowrap-num（不许折行）。
 *
 * ⚠️ 本文件列出的禁词不能出现在被扫描的生产文件里，注释也算 ——
 * 所以迁移组件时注释一律用中文描述。
 */

const COMPONENTS_DIR = path.resolve(import.meta.dirname);
const APP_SCREEN_DIR = path.resolve(import.meta.dirname, "../../app/screen");

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function productionFiles(): string[] {
  return walk(COMPONENTS_DIR)
    .concat(walk(APP_SCREEN_DIR))
    .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"));
}

function readStripped(file: string): string {
  // 剥掉注释再扫描，避免守卫自己的说明文字误伤（教训见视觉仓库 font-scale.test.ts）
  if (file.endsWith(".css")) {
    return readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  }
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** 拼接构造，避免本文件出现完整坏类名字面量被 Tailwind 扫到 */
const BAD_SIZE_PREFIX = "text-[" + "var(--fs-";

const BANNED_TOKENS = [
  // 旧视觉仓库 DTO 与 mock 管道
  "ScreenCrmPayload",
  "CrmDashboardResponse",
  "SalesTargetResponse",
  "SalesTargetItem",
  "buildMockScreenPayload",
  "/api/screen/crm",
  // 客户身份与内部字段
  "companyName",
  "customerName",
  "contactName",
  "receivingAddress",
  "fullAddress",
  "salesUser",
  "assignedUser",
  "followContent",
  "multipliers",
  // 地图密钥 / 原始 CRM 接口
  "TIANDITU_KEY",
  "mapKey",
  "geocode",
  "/api/crm/dashboard",
  "/api/dashboard",
] as const;

describe("sales screen component boundary", () => {
  it("keeps client-facing screen code free of legacy DTOs, sensitive fields, keys and CRM APIs", () => {
    const offenders: string[] = [];
    for (const file of productionFiles()) {
      const text = readStripped(file);
      for (const token of BANNED_TOKENS) {
        if (text.includes(token)) {
          offenders.push(`${path.relative(COMPONENTS_DIR, file)}: ${token}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("derives no totals from sample array lengths — summaries only", () => {
    // 只扫组件层（.tsx）：总量纪律是接收 payload 的组件的约束；
    // geo/布局等纯几何模块只接触静态地图数据与数字，不在此列。
    const offenders: string[] = [];
    for (const file of productionFiles()) {
      if (!file.endsWith(".tsx")) continue;
      const text = readStripped(file);
      for (const match of text.matchAll(/\.length/g)) {
        const usage = text
          .slice(match.index, match.index + 20)
          .replace(/\s+/g, " ");
        const allowed =
          usage.startsWith(".length === 0") ||
          usage.startsWith(".length > 0") ||
          usage.startsWith(".length !== 0");
        if (!allowed) {
          offenders.push(`${path.relative(COMPONENTS_DIR, file)}: ${usage}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("uses only the scoped screen text utilities — no bare px font sizes in components", () => {
    const offenders: string[] = [];
    for (const file of productionFiles()) {
      if (!file.endsWith(".tsx")) continue;
      const text = readStripped(file);
      for (const match of text.matchAll(/text-\[\d+px\]/g)) {
        offenders.push(`${path.relative(COMPONENTS_DIR, file)}: ${match[0]}`);
      }
      if (text.includes(BAD_SIZE_PREFIX)) {
        offenders.push(`${path.relative(COMPONENTS_DIR, file)}: size token as arbitrary value`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("sales screen stylesheet", () => {
  const cssFiles = productionFiles().filter((file) => file.endsWith(".css"));
  const css = cssFiles.map((file) => readStripped(file)).join("\n");

  it("exists and declares the size tokens on the screen root", () => {
    expect(cssFiles.length).toBeGreaterThanOrEqual(1);

    // 工具类通过 var() 引用根节点上的字号令牌（令牌是唯一真源）
    const tokens: Array<[string, string, number]> = [
      ["screen-text-display", "--fs-display", 18],
      ["screen-text-hero-lg", "--fs-hero-lg", 18],
      ["screen-text-hero", "--fs-hero", 18],
      ["screen-text-brand", "--fs-brand", 18],
      ["screen-text-brand-sm", "--fs-brand-sm", 18],
      ["screen-text-metric", "--fs-metric", 18],
      ["screen-text-label", "--fs-label", 18],
      ["screen-text-caption", "--fs-caption", 18],
      ["screen-text-micro", "--fs-micro", 18],
      ["screen-text-kicker", "--fs-kicker", 14],
    ];
    const rootBlock = css.match(/\.sales-screen-root\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rootBlock).not.toBe("");
    for (const [utility, token, min] of tokens) {
      const declared = rootBlock.match(new RegExp(String.raw`${token}:\s*(\d+)px`));
      expect(declared, token).not.toBeNull();
      expect(Number(declared?.[1]), token).toBeGreaterThanOrEqual(min);

      const rule = css.match(new RegExp(String.raw`\.${utility}\s*\{[^}]*\}`));
      expect(rule, utility).not.toBeNull();
      expect(rule?.[0], utility).toContain(`font-size: var(${token})`);
    }
  });

  it("scopes every selector to the screen root and namespaces keyframes", () => {
    const offenders: string[] = [];
    // 剥掉 @keyframes 整块（内层的 to/0%/70% 不是选择器），@media 只剥外壳
    const withoutKeyframes = css.replace(
      /@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g,
      "",
    );
    const withoutMedia = withoutKeyframes.replace(/@media[^{]*\{/g, "");
    for (const rule of withoutMedia.split("}")) {
      const selector = rule.split("{")[0]?.trim();
      if (!selector) continue;
      for (const part of selector.split(",")) {
        const name = part.trim();
        if (!name) continue;
        if (!name.startsWith(".sales-screen-root")) {
          offenders.push(name);
        }
      }
    }
    expect(offenders).toEqual([]);

    for (const match of css.matchAll(/@keyframes\s+([\w-]+)/g)) {
      expect(match[1].startsWith("screen-"), match[1]).toBe(true);
    }
    // 不许触碰平台 html/body/:root 等裸选择器
    expect(css).not.toMatch(/(^|[}\s])(html|body|:root)\s*[,{]/);
  });

  it("keeps the infinite animation budget at 8 or fewer and honors reduced motion", () => {
    const animatedClasses = [...css.matchAll(/\.([\w-]+)\s*\{[^}]*animation:[^;]*infinite/g)].map(
      (match) => match[1],
    );
    expect(animatedClasses.length).toBeGreaterThan(0);
    expect(animatedClasses.length).toBeLessThanOrEqual(8);

    const reducedMotion = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*$/);
    expect(reducedMotion).not.toBeNull();
    for (const className of animatedClasses) {
      expect(reducedMotion?.[0].includes(`.${className}`), className).toBe(true);
    }
  });

  it("keeps money readouts unwrappable", () => {
    for (const utility of ["money", "nowrap-num"]) {
      const rule = css.match(new RegExp(String.raw`\.${utility}\s*\{[^}]*\}`));
      expect(rule, utility).not.toBeNull();
      expect(rule?.[0]).toMatch(/white-space:\s*nowrap/);
    }
  });

  it("sets tabular numbers for the numeric readouts", () => {
    const numRule = css.match(/\.num\s*\{[^}]*\}/);
    expect(numRule).not.toBeNull();
    expect(numRule?.[0]).toMatch(/tabular-nums/);
  });
});
