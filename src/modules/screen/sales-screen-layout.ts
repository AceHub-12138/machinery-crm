/**
 * 展厅大屏纯布局解析器
 *
 * 五个模块开关 -> 一份稳定、可测试的布局计划。
 * 组件层只按计划渲染，不在 JSX 里堆叠条件类名；
 * 可见模块与开关严格一致，任何两个模块都不占用同一格子。
 *
 * 基准画布 1920×1080（冻结 Rev 5）：
 *   头部 88；行区 992（上下 padding 14）；行 = 838 | 112；列 = 360 | 880 | 1fr(624)。
 * 某一组关闭时，其余组通过弹性轨道稳定扩展，不留不可读空洞：
 *   - 中组地图保留 880 仅在三列齐全时成立；列数减少时地图成为弹性轨道并吃掉释放宽度；
 *   - 底栏关闭时上区占满释放出的高度；
 *   - 右组只剩一个模块时占满整个右列。
 */

import type { SalesScreenConfig } from "./config";

export type ScreenModuleId = keyof SalesScreenConfig["modules"];

export type SalesScreenColumnId = "left" | "map" | "right";

export type SalesScreenLayoutRegion = {
  id: ScreenModuleId;
  column: SalesScreenColumnId | "bottom";
  /** 外层栅格列（1 起） */
  gridColumn: number;
  /** 外层栅格列跨度；通栏底栏 = 列数 */
  gridColumnSpan: number;
  /** 外层栅格行（1 上区，2 底栏；单行布局恒为 1） */
  gridRow: number;
  /** 右列内部子行（1 环 / 2 预警），非右列模块为 null */
  rightRow: number | null;
};

export type SalesScreenMapBox = {
  /** 地图面板边框盒尺寸（px） */
  width: number;
  height: number;
};

export type SalesScreenLayoutPlan = {
  columns: Array<{ id: SalesScreenColumnId; track: string }>;
  /** 外层栅格 grid-template-rows */
  rows: string;
  /** 右列内部 grid-template-rows；右列整体关闭时为 null */
  rightRows: string | null;
  regions: SalesScreenLayoutRegion[];
  /** 地图面板边框盒尺寸；地图关闭时为 null */
  mapBox: SalesScreenMapBox | null;
  /** 上区行高（px），底栏关闭时吃满行区 */
  upperRowHeight: number;
};

export const SALES_SCREEN_STAGE_WIDTH = 1920;
export const SALES_SCREEN_STAGE_HEIGHT = 1080;
export const SALES_SCREEN_HEADER_HEIGHT = 88;
export const SALES_SCREEN_GUTTER = 14;
export const SALES_SCREEN_BOTTOM_ROW_HEIGHT = 112;

/**
 * 大屏 URL 查询参数解析：
 *  - ?fit=0  关闭自动等比缩放（1:1 审核模式）；
 *  - ?kiosk=1 进入展厅模式（光标隐藏等，样式落在大屏根节点 data 属性上）。
 */
export function parseScreenSearchParams(params: {
  [key: string]: string | string[] | undefined;
}): { fit: boolean; kiosk: boolean } {
  const first = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return {
    fit: first("fit") !== "0",
    kiosk: first("kiosk") === "1",
  };
}

/** 舞台等比缩放：取两轴较小者，保证 1920×1080 整屏始终可见。 */
export function computeStageScale(viewportWidth: number, viewportHeight: number): number {
  return Math.min(
    viewportWidth / SALES_SCREEN_STAGE_WIDTH,
    viewportHeight / SALES_SCREEN_STAGE_HEIGHT,
  );
}

const LEFT_COLUMN_WIDTH = 360;
const MAP_COLUMN_WIDTH = 880;
const RIGHT_COLUMN_WIDTH = 624;
const COLLECTION_PANEL_HEIGHT = 441;

const FLEXIBLE_TRACK = "minmax(0,1fr)";

/** 行区高度 = 舞台高 - 页头；栅格自身还有上下 padding 各一个 gutter */
const ROW_AREA_HEIGHT =
  SALES_SCREEN_STAGE_HEIGHT - SALES_SCREEN_HEADER_HEIGHT - SALES_SCREEN_GUTTER * 2;

function planColumnTracks(
  hasLeft: boolean,
  hasMap: boolean,
  hasRight: boolean,
): Array<{ id: SalesScreenColumnId; track: string }> {
  if (hasLeft && hasMap && hasRight) {
    return [
      { id: "left", track: `${LEFT_COLUMN_WIDTH}px` },
      { id: "map", track: `${MAP_COLUMN_WIDTH}px` },
      { id: "right", track: FLEXIBLE_TRACK },
    ];
  }

  const columns: Array<{ id: SalesScreenColumnId; track: string }> = [];
  if (hasLeft) columns.push({ id: "left", track: `${LEFT_COLUMN_WIDTH}px` });
  if (hasMap) columns.push({ id: "map", track: FLEXIBLE_TRACK });
  if (hasRight) {
    // 三列不再齐全：地图成为弹性轨道吃掉释放宽度，右列保持内容调校过的 624；
    // 地图不在场时右列自己扩展。
    columns.push(
      hasMap && !hasLeft
        ? { id: "right", track: `${RIGHT_COLUMN_WIDTH}px` }
        : { id: "right", track: FLEXIBLE_TRACK },
    );
  }
  if (columns.length === 0) {
    throw new Error("大屏至少需要启用一个板块");
  }
  return columns;
}

export function resolveSalesScreenLayout(
  modules: SalesScreenConfig["modules"],
): SalesScreenLayoutPlan {
  const hasLeft = modules.operatingKpis === true;
  const hasMap = modules.deliveryMap === true;
  const hasCollection = modules.collection === true;
  const hasAlerts = modules.deliveryAlerts === true;
  const hasRight = hasCollection || hasAlerts;
  const hasBottom = modules.deliveryMilestones === true;
  const hasUpper = hasLeft || hasMap || hasRight;

  if (!hasUpper && !hasBottom) {
    throw new Error("大屏至少需要启用一个板块");
  }

  const hasUpperModules = hasLeft || hasMap || hasRight;
  let columns = hasUpperModules
    ? planColumnTracks(hasLeft, hasMap, hasRight)
    // 仅底栏：舞台退化为单条弹性通栏轨道
    : [{ id: "left" as SalesScreenColumnId, track: FLEXIBLE_TRACK }];
  // 唯一可见列单独成屏时吃满整行（否则留下大块无内容空洞）
  if (columns.length === 1 && columns[0]!.track !== FLEXIBLE_TRACK) {
    columns = [{ ...columns[0]!, track: FLEXIBLE_TRACK }];
  }
  const columnCount = columns.length;
  const columnIndexOf = (id: SalesScreenColumnId) =>
    columns.findIndex((column) => column.id === id) + 1;

  // 底栏开启：行 = 上区(1fr) | 112；关闭：上区吃满行区；
  // 仅底栏时同样单行占满（里程碑内容自身垂直居中，不留空洞）。
  const rows = hasUpper && hasBottom
    ? `${FLEXIBLE_TRACK} ${SALES_SCREEN_BOTTOM_ROW_HEIGHT}px`
    : FLEXIBLE_TRACK;
  const upperRowHeight = hasUpper && hasBottom ? ROW_AREA_HEIGHT - SALES_SCREEN_GUTTER - SALES_SCREEN_BOTTOM_ROW_HEIGHT : ROW_AREA_HEIGHT;

  // 地图列的解析宽度（供地图视口几何使用）：
  // 地图自身是固定轨道时直接取轨道值；作为弹性轨道时吃掉剩余宽度。
  let mapBox: SalesScreenMapBox | null = null;
  if (hasMap) {
    const mapTrack = columns.find((column) => column.id === "map")!.track;
    const fixedWidth = columns
      .filter((column) => column.id !== "map" && column.track !== FLEXIBLE_TRACK)
      .reduce((sum, column) => sum + Number(column.track.replace("px", "")), 0);
    const mapWidth =
      mapTrack !== FLEXIBLE_TRACK
        ? Number(mapTrack.replace("px", ""))
        : SALES_SCREEN_STAGE_WIDTH -
          SALES_SCREEN_GUTTER * 2 -
          (columnCount - 1) * SALES_SCREEN_GUTTER -
          fixedWidth;
    mapBox = { width: mapWidth, height: upperRowHeight };
  }

  const rightRows = hasRight
    ? hasCollection && hasAlerts
      ? `${COLLECTION_PANEL_HEIGHT}px ${FLEXIBLE_TRACK}`
      : FLEXIBLE_TRACK
    : null;

  const regions: SalesScreenLayoutRegion[] = [];
  if (hasLeft) {
    regions.push({
      id: "operatingKpis",
      column: "left",
      gridColumn: columnIndexOf("left"),
      gridColumnSpan: 1,
      gridRow: 1,
      rightRow: null,
    });
  }
  if (hasMap) {
    regions.push({
      id: "deliveryMap",
      column: "map",
      gridColumn: columnIndexOf("map"),
      gridColumnSpan: 1,
      gridRow: 1,
      rightRow: null,
    });
  }
  if (hasCollection) {
    regions.push({
      id: "collection",
      column: "right",
      gridColumn: columnIndexOf("right"),
      gridColumnSpan: 1,
      gridRow: 1,
      rightRow: 1,
    });
  }
  if (hasAlerts) {
    regions.push({
      id: "deliveryAlerts",
      column: "right",
      gridColumn: columnIndexOf("right"),
      gridColumnSpan: 1,
      gridRow: 1,
      rightRow: hasCollection ? 2 : 1,
    });
  }
  if (hasBottom) {
    regions.push({
      id: "deliveryMilestones",
      column: "bottom",
      gridColumn: 1,
      gridColumnSpan: Math.max(columnCount, 1),
      gridRow: hasUpper ? 2 : 1,
      rightRow: null,
    });
  }

  return { columns, rows, rightRows, regions, mapBox, upperRowHeight };
}
