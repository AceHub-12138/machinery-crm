import { chinaMapData } from "./china-map";
import { neighborAdminLines as neighborAdminLinesData } from "./neighbor-admin-lines";

export type MapProvince = {
  name: string;
  short: string;
  adcode: string;
  d: string;
  x: number;
  y: number;
  label: boolean;
};

export type MapNeighbor = {
  name: string;
  /** 视觉远近：0 接壤 / 1 近邻 / 2 外围。渲染时逐级变淡。 */
  order: number;
  d: string;
  x?: number;
  y?: number;
};

export type ChinaMap = {
  viewBox: string;
  width: number;
  height: number;
  /** 画布对应的经纬窗口，与构建脚本共用。 */
  lonLat: { lon: { min: number; max: number }; lat: { min: number; max: number } };
  /** 每经纬度多少画布单位。等距圆柱投影，x/y 同值。 */
  pitch: number;
  /** 中国本土在画布上的包围盒（不含邻国），用于定位光环与球面明暗。 */
  china: { minX: number; minY: number; maxX: number; maxY: number };
  factory: { lon: number; lat: number; name: string; x: number; y: number };
  provinces: MapProvince[];
  neighbors: MapNeighbor[];
  /** 合并后的国界轮廓，按面积从大到小；用于给中国整体描一条发光边。 */
  silhouette: Array<{ d: string; area: number }>;
  /** 球面经纬网，由构建脚本用同一套投影生成，因此与中国轮廓严格对齐。 */
  graticule: {
    meridians: Array<{ lon: number; d: string; emphasis: boolean }>;
    parallels: Array<{ lat: number; d: string; emphasis: boolean }>;
  };
};

export type MapPoint = { x: number; y: number };

export const chinaMap = chinaMapData as unknown as ChinaMap;

export type NeighborAdminLine = { key: string; d: string };

/**
 * 邻国一级行政区内边线（Natural Earth admin-1，只含同国两区共享的边，
 * 不含海岸线与国界）。按国家合并成单条 path，画在邻国之上、中国之下，
 * 低透明度做质感，不与省界/国界抢。
 */
export const neighborAdminLines = neighborAdminLinesData.lines as unknown as NeighborAdminLine[];

/**
 * 经纬度 → 画布坐标。
 *
 * 与构建脚本里投影省界用的是同一套参数（同一个 pitch 与同一个经纬窗口），
 * 否则工厂锚点、城市标签会和省界错位。数字统一保留 4 位小数，
 * 服务端与浏览器计算一致，避免 hydration 告警。
 */
export function projectLonLat(lon: number, lat: number): MapPoint & { lng: number; lat: number } {
  const { lonLat, pitch } = chinaMap;
  return {
    x: Number(((lon - lonLat.lon.min) * pitch).toFixed(2)),
    y: Number(((lonLat.lat.max - lat) * pitch).toFixed(2)),
    lng: lon,
    lat,
  };
}

export function createScreenArc(start: MapPoint, end: MapPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy) || 1;
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const bend = Math.min(Math.max(distance * 0.16, 18), 86);
  const cx = (start.x + end.x) / 2 + normalX * bend;
  const cy = (start.y + end.y) / 2 + normalY * bend;
  return {
    d: `M ${start.x} ${start.y} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${end.x} ${end.y}`,
    length: distance,
  };
}

export function matchProvinceKey(region: string) {
  return region.replace(/(省|市|自治区|特别行政区|壮族|回族|维吾尔)/g, "");
}

/* ------------------------------------------------------------------ *
 * 地图标签防重叠（纯几何，画布坐标系）
 * ------------------------------------------------------------------ */

/** 标签字号（画布单位）。渲染到 880 面板约 ×0.72 —— 屏幕 13.7~15.8px。 */
export const LABEL_SIZES = { province: 19, city: 22, neighbor: 17 } as const;

export type Placed = {
  id: string;
  text: string;
  x: number;
  y: number;
  size: number;
  cls: string;
  fill: string;
  anchor: "start" | "middle" | "end";
};

/** 8 方向候选，按优先级排列：右 → 左 → 上 → 下 → 四角。 */
const OFFSETS: Array<[number, number, Placed["anchor"]]> = [
  [1, 0, "start"],
  [-1, 0, "end"],
  [0, -1, "middle"],
  [0, 1, "middle"],
  [0.8, -1, "start"],
  [-0.8, -1, "end"],
  [0.8, 1, "start"],
  [-0.8, 1, "end"],
];

/**
 * 文本框高度必须按「行高」而不是「字号」估：
 * 用字号估会低估近 30%，京/津、皖/苏这种紧邻的省名就会叠在一起。
 */
const BOX_ASCENT = 0.88;
const BOX_DESCENT = 0.32;

function estimateWidth(text: string, size: number, anchor: Placed["anchor"]) {
  const width = text.length * size;
  if (anchor === "middle") return { left: -width / 2, right: width / 2 };
  if (anchor === "end") return { left: -width, right: 0 };
  return { left: 0, right: width };
}

/**
 * 标签防重叠：城市 > 省名 > 邻国，先到先占位。
 * 每个标签试 8 个方向，取第一个不冲突的位置；都放不下就丢弃，
 * 所以地图上永远不会出现两段文字叠在一起。
 */
export function placeLabels(
  tiers: Array<{
    items: Array<{ id: string; text: string; x: number; y: number; fill: string; cls: string; size: number }>;
  }>,
): Placed[] {
  const placed: Placed[] = [];
  const boxes: Array<{ l: number; r: number; t: number; b: number }> = [];

  for (const tier of tiers) {
    for (const item of tier.items) {
      const { id, text, x: ax, y: ay, size, cls, fill } = item;
      const gap = size * 0.16;
      for (const [dx, dy, anchor] of OFFSETS) {
        // 纵向步进按行高（约 1.05×size）算，避免上下两个标签只错开半行
        const x = ax + dx * size;
        const y = ay + dy * (size * 1.05);
        const { left, right } = estimateWidth(text, size, anchor);
        const box = {
          l: x + left - gap,
          r: x + right + gap,
          t: y - size * BOX_ASCENT - gap,
          b: y + size * BOX_DESCENT + gap,
        };
        const hit = boxes.some(
          (other) => box.l < other.r && box.r > other.l && box.t < other.b && box.b > other.t,
        );
        if (hit) continue;
        boxes.push(box);
        placed.push({ id, text, x, y, size, cls, fill, anchor });
        break;
      }
    }
  }
  return placed;
}

export const mapViewBox: string = chinaMap.viewBox;

/** 中国本土的画布包围盒（不含邻国）。 */
export const mapBBox = {
  minX: chinaMap.china.minX,
  minY: chinaMap.china.minY,
  maxX: chinaMap.china.maxX,
  maxY: chinaMap.china.maxY,
  width: chinaMap.china.maxX - chinaMap.china.minX,
  height: chinaMap.china.maxY - chinaMap.china.minY,
};

/** 海岸线 + 陆地边界 —— 描发光边用的路径。 */
export const chinaSilhouette: string = chinaMap.silhouette.map((part) => part.d).join(" ");

/**
 * 球面网格与光环的圆心。
 *
 * 取画布中心而不是陆地包围盒中心：光环要铺满整个画布才算「地球弧面」。
 * 画布中心同时也是经纬窗口的中心，所以中国天然落在光环中央。
 */
export const sphereCenter = { x: chinaMap.width / 2, y: chinaMap.height / 2 };

/**
 * 同心光环：椭圆而不是圆 —— 按画布宽高分别给 rx / ry，
 * 环就永远贴着画布轮廓，不会出现被裁过的圆。
 */
export const sphereRings: Array<{
  scale: number;
  opacity: number;
  dash?: string;
  width: number;
  glow?: boolean;
}> = [
  { scale: 1.06, opacity: 0.5, width: 1.6, glow: true },
  { scale: 1.26, opacity: 0.32, width: 1.3, dash: "12 16" },
  { scale: 1.5, opacity: 0.2, width: 1.1 },
  { scale: 1.78, opacity: 0.12, width: 1, dash: "7 20" },
  { scale: 2.1, opacity: 0.07, width: 1 },
];

/**
 * 地图视口几何：在任意面板尺寸下把中国本土居中。
 *
 * 视口必须由「宽度定标」（画布宽高比 1.303，面板更矮时退化为按高度定标），
 * 并整体纵向修正：画布纬度窗口中心（30.5°N）为给球面光环留位而低于
 * 中国本土纬度中心（36.3°N），直接居中会让中国整体偏下。
 *
 * top 的修正量 = (画布中心 - 中国本土中心) × 缩放，使中国中心恰好落在
 * 面板内容区中心。面板内缩 6px 的口径与冻结版一致。
 */
export function computeMapViewport(innerWidth: number, innerHeight: number) {
  const inset = 12; // 两侧各 6px 内缩（口径与冻结版一致：内框 - 12）
  const scale = Math.min((innerWidth - inset) / chinaMap.width, innerHeight / chinaMap.height);
  const width = Number((chinaMap.width * scale).toFixed(2));
  const height = Number((chinaMap.height * scale).toFixed(2));
  const left = Number(((innerWidth - width) / 2).toFixed(2));
  const chinaCenterY = (chinaMap.china.minY + chinaMap.china.maxY) / 2;
  const top = Number(
    ((innerHeight - height) / 2 + (chinaMap.height / 2 - chinaCenterY) * scale).toFixed(2),
  );
  return { left, top, width, height, scale };
}

/* ------------------------------------------------------------------ *
 * 滚轮缩放 / 拖拽平移（纯几何：viewBox 子窗口模型）
 *
 * 窗口 {x,y,w,h} 是基础 viewBox 的子矩形；放大倍率 k = 基础宽 / 窗口宽。
 * w、h 永远按同一因子缩放，纵横比与基础 viewBox 一致，不会被拉伸。
 * ------------------------------------------------------------------ */

export type MapZoom = { x: number; y: number; w: number; h: number };

/** 缩放倍率上下限：1× 全图，5× 到顶。 */
export const MAP_ZOOM_MIN = 1;
export const MAP_ZOOM_MAX = 5;

/** 地图交互闲置多久后自动回全图。 */
export const MAP_IDLE_RESET_MS = 90_000;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number) {
  return Number(value.toFixed(2));
}

/** 全图视口（缩放复位态）。 */
export function baseMapZoom(): MapZoom {
  return { x: 0, y: 0, w: chinaMap.width, h: chinaMap.height };
}

/** 当前放大倍率：基础宽 / 当前窗口宽，全图时为 1。 */
export function zoomScale(zoom: MapZoom): number {
  return chinaMap.width / zoom.w;
}

/**
 * 缩放补偿因子：invK = 1/k —— 辉光/圆点/航线等放大后视觉尺寸恒定；
 * invSk = 1/√k —— 省界、经纬网等细节线放大时适度变粗，呈现「放大见细节」。
 */
export function compensationFactors(zoom: MapZoom): { invK: number; invSk: number } {
  const k = zoomScale(zoom);
  return { invK: Number((1 / k).toFixed(4)), invSk: Number((1 / Math.sqrt(k)).toFixed(4)) };
}

/** 动态 viewBox 属性值（状态已按 2 位小数取整，这里只拼接）。 */
export function zoomViewBoxAttr(zoom: MapZoom): string {
  return `${zoom.x} ${zoom.y} ${zoom.w} ${zoom.h}`;
}

/** 滚轮一格 → 相对缩放因子：向上放大、向下缩小，指数曲线手感均匀。 */
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.0016);
}

/**
 * 以画布点 (cx, cy) 为锚点缩放 factor 倍。
 * 锚点下的地理点缩放前后不动；倍率 clamp 到 [1,5]，
 * 平移 clamp 到基础 viewBox 内 —— k=1 时窗口恒等于全图。
 */
export function zoomAt(zoom: MapZoom, cx: number, cy: number, factor: number): MapZoom {
  const k = clamp(zoomScale(zoom) * factor, MAP_ZOOM_MIN, MAP_ZOOM_MAX);
  const w = round2(chinaMap.width / k);
  const h = round2(chinaMap.height / k);
  const x = clamp(round2(cx - ((cx - zoom.x) * w) / zoom.w), 0, chinaMap.width - w);
  const y = clamp(round2(cy - ((cy - zoom.y) * h) / zoom.h), 0, chinaMap.height - h);
  return { x, y, w, h };
}

/** 平移窗口（画布单位），始终 clamp 在基础 viewBox 内。 */
export function panZoom(zoom: MapZoom, dx: number, dy: number): MapZoom {
  const x = clamp(round2(zoom.x + dx), 0, chinaMap.width - zoom.w);
  const y = clamp(round2(zoom.y + dy), 0, chinaMap.height - zoom.h);
  return { ...zoom, x, y };
}

/* ------------------------------------------------------------------ *
 * 终点扇形散开：无 city 的路线终点全压在省中心坐标上，多单省份
 * （如山东 24 单）会叠成一团。按终点坐标分桶，桶内沿圆环等分散开。
 * ------------------------------------------------------------------ */

/** 散开半径上限（画布单位）。 */
export const FAN_RADIUS_MAX = 10;

/** FNV-1a 32 位：同一 key 永远同一哈希 —— 散开的确定性来源。 */
export function hashRouteKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 终点散开：终点坐标完全相同的路线进同一桶；桶内先按 key 哈希排序
 * （顺序与输入顺序无关），再沿圆环等分占位，相位与半径由哈希推出。
 * 单条路线原样返回；同一输入永远同一输出。
 */
export function fanOutRouteEnds(
  routes: Array<{ key: string; x: number; y: number }>,
): Map<string, MapPoint> {
  const buckets = new Map<string, Array<{ key: string; x: number; y: number }>>();
  for (const route of routes) {
    const bucketKey = `${route.x},${route.y}`;
    const bucket = buckets.get(bucketKey);
    if (bucket) bucket.push(route);
    else buckets.set(bucketKey, [route]);
  }

  const result = new Map<string, MapPoint>();
  for (const bucket of buckets.values()) {
    if (bucket.length === 1) {
      result.set(bucket[0].key, { x: bucket[0].x, y: bucket[0].y });
      continue;
    }
    const ordered = [...bucket].sort((a, b) => hashRouteKey(a.key) - hashRouteKey(b.key));
    // 半径随桶大小增长、封顶 10；相位由首条路线的哈希决定
    const radius = Math.min(FAN_RADIUS_MAX, 2.5 + 1.5 * Math.sqrt(ordered.length - 1));
    const phase = (hashRouteKey(ordered[0].key) / 0x100000000) * Math.PI * 2;
    ordered.forEach((route, index) => {
      const angle = phase + (index / ordered.length) * Math.PI * 2;
      result.set(route.key, {
        x: round2(route.x + radius * Math.cos(angle)),
        y: round2(route.y + radius * Math.sin(angle)),
      });
    });
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * 密度自适应透明度：航线总数越大，单条基础透明度越低，
 * 避免 80+ 条航线把整幅地图糊死。active 高亮不参与折减。
 * ------------------------------------------------------------------ */

export const ARC_CORE_OPACITY = 0.42;
export const ARC_FLOW_OPACITY = 0.5;

/** 密度折减系数：√(24/n)，n≤24 不折减，n→∞ 保底 0.35。 */
export function arcDensityFactor(routeCount: number): number {
  return clamp(Math.sqrt(24 / Math.max(1, routeCount)), 0.35, 1);
}

/**
 * 航线基础透明度（halo/core/flow 三层中的 core 与 flow；
 * halo 0.1 与 active 0.95 不折减）。
 * 入参取整个样本数组：计数纪律上组件层不从数组长度推导任何「总量」，
 * 长度读取收在纯函数里。
 */
export function arcBaseOpacities(routes: ReadonlyArray<unknown>): { core: number; flow: number } {
  const factor = arcDensityFactor(routes.length);
  return {
    core: Number((ARC_CORE_OPACITY * factor).toFixed(3)),
    flow: Number((ARC_FLOW_OPACITY * factor).toFixed(3)),
  };
}
