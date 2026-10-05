import { describe, expect, it } from "vitest";
import {
  computeStageScale,
  parseScreenSearchParams,
  SALES_SCREEN_BOTTOM_ROW_HEIGHT,
  SALES_SCREEN_GUTTER,
  SALES_SCREEN_HEADER_HEIGHT,
  SALES_SCREEN_STAGE_HEIGHT,
  SALES_SCREEN_STAGE_WIDTH,
  resolveSalesScreenLayout,
  type SalesScreenLayoutPlan,
  type ScreenModuleId,
} from "./sales-screen-layout";
import type { SalesScreenConfig } from "./config";

type Modules = SalesScreenConfig["modules"];

const ALL_ON: Modules = {
  operatingKpis: true,
  deliveryMap: true,
  collection: true,
  deliveryAlerts: true,
  deliveryMilestones: true,
};

const ALL_OFF: Modules = {
  operatingKpis: false,
  deliveryMap: false,
  collection: false,
  deliveryAlerts: false,
  deliveryMilestones: false,
};

const MODULE_IDS: ScreenModuleId[] = [
  "operatingKpis",
  "deliveryMap",
  "collection",
  "deliveryAlerts",
  "deliveryMilestones",
];

function modulesWith(active: ScreenModuleId[]): Modules {
  const modules = { ...ALL_OFF };
  for (const id of active) modules[id] = true;
  return modules;
}

/** 2^5 - 1 = 31 种合法非空组合 */
function* nonEmptyCombinations(): Generator<ScreenModuleId[]> {
  for (let mask = 1; mask < 32; mask += 1) {
    yield MODULE_IDS.filter((_, index) => (mask & (1 << index)) !== 0);
  }
}

const REGION_TITLES: Record<ScreenModuleId, string> = {
  operatingKpis: "经营指标",
  deliveryMap: "交付态势",
  collection: "合同与回款",
  deliveryAlerts: "交付预警",
  deliveryMilestones: "交付里程碑",
};

describe("resolveSalesScreenLayout", () => {
  it("freezes the Rev 5 default grid when every module is on", () => {
    const plan = resolveSalesScreenLayout(ALL_ON);

    expect(plan.columns).toEqual([
      { id: "left", track: "360px" },
      { id: "map", track: "880px" },
      { id: "right", track: "minmax(0,1fr)" },
    ]);
    expect(plan.rows).toBe("minmax(0,1fr) 112px");
    expect(plan.rightRows).toBe("441px minmax(0,1fr)");
    expect(plan.upperRowHeight).toBe(838);
    expect(plan.mapBox).toEqual({ width: 880, height: 838 });
  });

  it("keeps stage arithmetic exact for every combination — no overflow, no leftover hole", () => {
    for (const active of nonEmptyCombinations()) {
      const plan = resolveSalesScreenLayout(modulesWith(active));

      // 列轨道：最多一条弹性轨道；固定轨道 + 间隙 + 内边距必须正好铺满 1920
      const fixedWidths = plan.columns
        .map((column) => column.track)
        .filter((track) => track !== "minmax(0,1fr)")
        .map((track) => Number(track.replace("px", "")));
      const flexibleCount = plan.columns.filter(
        (column) => column.track === "minmax(0,1fr)",
      ).length;
      // 任何组合都必须恰好有弹性轨道吸收释放的宽度，否则留下无内容空洞
      expect(flexibleCount).toBeGreaterThanOrEqual(1);
      expect(flexibleCount).toBeLessThanOrEqual(1);

      const totalWidth =
        fixedWidths.reduce((sum, width) => sum + width, 0) +
        flexibleCount * 1 +
        (plan.columns.length - 1) * SALES_SCREEN_GUTTER +
        SALES_SCREEN_GUTTER * 2;
      expect(totalWidth).toBeLessThanOrEqual(SALES_SCREEN_STAGE_WIDTH);

      // 行轨道：上区存在且底栏开启时固定 112；其余（含仅底栏）单行占满
      const hasUpper = active.some((id) => id !== "deliveryMilestones");
      const hasBottom = active.includes("deliveryMilestones");
      expect(plan.rows).toBe(
        hasUpper && hasBottom ? `minmax(0,1fr) ${SALES_SCREEN_BOTTOM_ROW_HEIGHT}px` : "minmax(0,1fr)",
      );
      const expectedUpper = hasUpper && hasBottom
        ? SALES_SCREEN_STAGE_HEIGHT -
          SALES_SCREEN_HEADER_HEIGHT -
          SALES_SCREEN_GUTTER * 2 -
          SALES_SCREEN_GUTTER -
          SALES_SCREEN_BOTTOM_ROW_HEIGHT
        : SALES_SCREEN_STAGE_HEIGHT - SALES_SCREEN_HEADER_HEIGHT - SALES_SCREEN_GUTTER * 2;
      expect(plan.upperRowHeight).toBe(expectedUpper);
      expect(plan.upperRowHeight).toBeGreaterThan(0);
    }
  });

  it("renders exactly the enabled modules for all 31 legal combinations", () => {
    for (const active of nonEmptyCombinations()) {
      const plan = resolveSalesScreenLayout(modulesWith(active));
      const regionIds = plan.regions.map((region) => region.id).sort();
      expect(regionIds).toEqual([...active].sort());
    }
  });

  it("never lets two modules occupy the same cell", () => {
    for (const active of nonEmptyCombinations()) {
      const plan = resolveSalesScreenLayout(modulesWith(active));
      const rightRegions = plan.regions.filter(
        (region) => region.column === "right",
      );
      const nonRightRegions = plan.regions.filter(
        (region) => region.column !== "right",
      );
      // 右列内部子行不得重复；其余区域的外层格子不得重复
      const rightRows = rightRegions.map((region) => region.rightRow);
      expect(new Set(rightRows).size).toBe(rightRows.length);
      const cells = nonRightRegions.map(
        (region) => `${region.gridColumn}:${region.gridRow}`,
      );
      expect(new Set(cells).size).toBe(cells.length);
    }
  });

  it("makes a lone right-side module fill the whole right column", () => {
    for (const lone of ["collection", "deliveryAlerts"] as ScreenModuleId[]) {
      const plan = resolveSalesScreenLayout(
        modulesWith([lone, "operatingKpis", "deliveryMap", "deliveryMilestones"]),
      );
      expect(plan.rightRows).toBe("minmax(0,1fr)");
      const loneRegion = plan.regions.find((region) => region.id === lone);
      expect(loneRegion?.rightRow).toBe(1);
    }
  });

  it("stacks both right-side modules with the frozen 441px collection panel first", () => {
    const plan = resolveSalesScreenLayout(ALL_ON);
    const collection = plan.regions.find((region) => region.id === "collection");
    const alerts = plan.regions.find((region) => region.id === "deliveryAlerts");
    expect(plan.rightRows).toBe("441px minmax(0,1fr)");
    expect(collection?.rightRow).toBe(1);
    expect(alerts?.rightRow).toBe(2);
  });

  it("gives the upper row the freed height when the milestone strip is closed", () => {
    const withBottom = resolveSalesScreenLayout(ALL_ON);
    const withoutBottom = resolveSalesScreenLayout({
      ...ALL_ON,
      deliveryMilestones: false,
    });
    expect(withBottom.upperRowHeight).toBe(838);
    expect(withoutBottom.upperRowHeight).toBe(
      SALES_SCREEN_STAGE_HEIGHT - SALES_SCREEN_HEADER_HEIGHT - SALES_SCREEN_GUTTER * 2,
    );
    expect(withoutBottom.rows).toBe("minmax(0,1fr)");
  });

  it("expands the remaining columns when one of the three columns is closed", () => {
    const withoutLeft = resolveSalesScreenLayout({
      ...ALL_ON,
      operatingKpis: false,
    });
    expect(withoutLeft.columns).toEqual([
      { id: "map", track: "minmax(0,1fr)" },
      { id: "right", track: "624px" },
    ]);

    const withoutMap = resolveSalesScreenLayout({ ...ALL_ON, deliveryMap: false });
    expect(withoutMap.columns).toEqual([
      { id: "left", track: "360px" },
      { id: "right", track: "minmax(0,1fr)" },
    ]);
    expect(withoutMap.mapBox).toBeNull();

    const withoutRight = resolveSalesScreenLayout({
      ...ALL_ON,
      collection: false,
      deliveryAlerts: false,
    });
    expect(withoutRight.columns).toEqual([
      { id: "left", track: "360px" },
      { id: "map", track: "minmax(0,1fr)" },
    ]);
    expect(withoutRight.rightRows).toBeNull();
  });

  it("keeps every visible module anchored to an explicit cell", () => {
    const plan: SalesScreenLayoutPlan = resolveSalesScreenLayout(ALL_ON);
    expect(plan.regions.length).toBe(5);
    for (const region of plan.regions) {
      expect(region.gridColumn).toBeGreaterThanOrEqual(1);
      expect(region.gridColumn).toBeLessThanOrEqual(plan.columns.length);
      expect(region.gridRow).toBeGreaterThanOrEqual(1);
      expect(region.gridRow).toBeLessThanOrEqual(2);
    }
    const bottom = plan.regions.find((region) => region.id === "deliveryMilestones");
    expect(bottom?.column).toBe("bottom");
    expect(bottom?.gridColumnSpan).toBe(plan.columns.length);
    expect(bottom?.gridRow).toBe(2);
  });

  it("lets the milestone strip take the whole stage when it is the only module", () => {
    const plan = resolveSalesScreenLayout(modulesWith(["deliveryMilestones"]));
    expect(plan.columns).toEqual([{ id: "left", track: "minmax(0,1fr)" }]);
    expect(plan.rows).toBe("minmax(0,1fr)");
    const bottom = plan.regions.find((region) => region.id === "deliveryMilestones");
    expect(bottom?.gridRow).toBe(1);
    expect(bottom?.gridColumnSpan).toBe(1);
  });

  it("maps every module id to a distinct human title so the board can assert visibility", () => {
    expect(new Set(Object.values(REGION_TITLES)).size).toBe(MODULE_IDS.length);
  });

  it("refuses to plan an empty screen", () => {
    expect(() => resolveSalesScreenLayout(ALL_OFF)).toThrow();
  });
});

describe("parseScreenSearchParams", () => {
  it("disables auto fit only for fit=0 (1:1 audit mode)", () => {
    expect(parseScreenSearchParams({ fit: "0" }).fit).toBe(false);
    expect(parseScreenSearchParams({ fit: "1" }).fit).toBe(true);
    expect(parseScreenSearchParams({}).fit).toBe(true);
    expect(parseScreenSearchParams({ fit: ["0", "1"] }).fit).toBe(false);
  });

  it("enables kiosk mode only for kiosk=1", () => {
    expect(parseScreenSearchParams({ kiosk: "1" }).kiosk).toBe(true);
    expect(parseScreenSearchParams({ kiosk: "0" }).kiosk).toBe(false);
    expect(parseScreenSearchParams({}).kiosk).toBe(false);
  });
});

describe("computeStageScale", () => {
  it("scales the 1920×1080 stage uniformly to the viewport", () => {
    expect(computeStageScale(1920, 1080)).toBe(1);
    // 1366×768 时高度受限：以高度为准
    expect(computeStageScale(1366, 768)).toBeCloseTo(768 / 1080, 6);
    expect(computeStageScale(1366, 768)).toBeLessThan(1366 / 1920);
  });

  it("takes the smaller axis so the whole stage always fits", () => {
    // 高度受限：以高度为准
    expect(computeStageScale(2560, 1080)).toBe(1);
    // 宽度受限：以宽度为准
    expect(computeStageScale(1280, 2160)).toBeCloseTo(1280 / 1920, 6);
  });
});
