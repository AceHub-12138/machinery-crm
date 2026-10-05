"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  chinaMap,
  chinaSilhouette,
  computeMapViewport,
  createScreenArc,
  fanOutRouteEnds,
  baseMapZoom,
  panZoom,
  projectLonLat,
  matchProvinceKey,
  placeLabels,
  sphereCenter,
  sphereRings,
  wheelZoomFactor,
  zoomAt,
  zoomScale,
  zoomViewBoxAttr,
  compensationFactors,
  neighborAdminLines,
  arcBaseOpacities,
  MAP_IDLE_RESET_MS,
  mapViewBox,
  LABEL_SIZES,
  type MapZoom,
} from "./geo";
import { formatCount } from "./format";
import type { PublicSalesScreenPayload, PublicRouteSample } from "@/modules/screen/public-types";

type DeliverySummary = PublicSalesScreenPayload["delivery"]["summary"];

/* 高度色阶：0 发货 → 最高发货。用于省级填充。 */
const HEAT_SCALE = [
  "var(--heat-0)",
  "var(--heat-1)",
  "var(--heat-2)",
  "var(--heat-3)",
  "var(--heat-4)",
  "var(--heat-5)",
] as const;
/** 色阶层级数（6 档，与 HEAT_SCALE 一一对应；geo 测试守卫档位完整） */
const HEAT_LEVELS = 6;

/** 邻国按视觉远近取色，越远越暗，形成球面纵深。 */
const NEIGHBOR_FILL = ["var(--c-neighbor-0)", "var(--c-neighbor-1)", "var(--c-neighbor-2)"] as const;
const NEIGHBOR_LABEL_FILL = [
  "rgba(206, 222, 242, 0.78)",
  "rgba(186, 206, 230, 0.6)",
  "rgba(166, 188, 214, 0.42)",
] as const;

/** 按下后位移小于该值仍视为点击（节点高亮不被拖拽破坏）。 */
const DRAG_CLICK_SLOP_PX = 4;

/** 航线/节点 active 高亮透明度：不参与密度折减。 */
const ARC_ACTIVE_OPACITY = 0.95;

function heatIndex(count: number, max: number) {
  if (count <= 0) return 0;
  return (
    1 +
    Math.min(
      HEAT_LEVELS - 2,
      Math.floor((count / Math.max(max, 1)) * (HEAT_LEVELS - 1.001)),
    )
  );
}

/** client 坐标 → SVG 画布坐标（含动态 viewBox，由 getScreenCTM 换算）。 */
function clientToCanvas(svg: SVGSVGElement, clientX: number, clientY: number) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: point.x, y: point.y };
}

type DragState = {
  startX: number;
  startY: number;
  /** 拖拽开始时 client→画布 的比例（x/y 各一份，meet 缩放下两者相等） */
  invA: number;
  invD: number;
  zoomStart: MapZoom;
  moved: boolean;
};

/**
 * 全国交付态势地图。
 *
 * 只使用公开白名单字段：路线终点是省/市中心投影坐标，热度与排行由样本构造；
 * 标题栏三个数字全部来自显式汇总，不从样本长度推导。
 *
 * 交互：滚轮以光标为锚缩放（1–5×）、按住拖拽平移、双击回全图、
 * 闲置 90 秒自动回全图。球面光环与球面明暗是画布级背景，
 * 留在静态 viewBox 的底层 SVG 里，不随缩放变形。
 */
export function ShipmentMap({
  routes,
  summary,
  mapBox,
}: {
  routes: PublicRouteSample[];
  summary: DeliverySummary;
  mapBox: { width: number; height: number };
}) {
  const provinces = chinaMap.provinces;
  const neighbors = chinaMap.neighbors;
  const factory = chinaMap.factory;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<MapZoom>(baseMapZoom);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const active = routes.find((route) => route.key === activeId) ?? routes[0];

  // 反向补偿：invK 让描边/字号/半径放大后视觉恒定；invSk（1/√k）让
  // 省界/经纬网等细节线放大时适度变粗，呈现「放大见细节」
  const { invK, invSk } = compensationFactors(zoom);

  // 滚轮缩放：React 合成 onWheel 是 passive 的，必须用原生非 passive 监听才能 preventDefault
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const anchor = clientToCanvas(svg, event.clientX, event.clientY);
      if (!anchor) return;
      setZoom((prev) => zoomAt(prev, anchor.x, anchor.y, wheelZoomFactor(event.deltaY)));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  // 闲置 90 秒自动回全图：任何缩放/平移都重置计时，全图状态不计时
  useEffect(() => {
    if (zoomScale(zoom) <= 1) return;
    const timer = window.setTimeout(() => setZoom(baseMapZoom()), MAP_IDLE_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [zoom]);

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const svg = svgRef.current;
    if (!svg) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const inverse = ctm.inverse();
    suppressClickRef.current = false;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      invA: inverse.a,
      invD: inverse.d,
      zoomStart: zoom,
      moved: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_CLICK_SLOP_PX) return;
      drag.moved = true;
      suppressClickRef.current = true;
    }
    setZoom(panZoom(drag.zoomStart, -dx * drag.invA, -dy * drag.invD));
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const onDoubleClick = () => {
    setZoom(baseMapZoom());
  };

  /** 样本终点：省/市中心投影后，同坐标多路线做确定性扇形散开 */
  const destinations = useMemo(() => {
    const raw = routes.map((route) => {
      const point = projectLonLat(route.centerLng, route.centerLat);
      return { key: route.key, x: point.x, y: point.y };
    });
    return fanOutRouteEnds(raw);
  }, [routes]);

  const heat = useMemo(() => {
    const counts = new Map<string, number>();
    for (const route of routes) {
      const key = matchProvinceKey(route.province);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return { counts, max: Math.max(1, ...counts.values()) };
  }, [routes]);

  /** 密度自适应透明度：航线越多单条越淡 */
  const arcOpacity = useMemo(() => arcBaseOpacities(routes), [routes]);

  const arcs = useMemo(
    () =>
      routes.map((route, index) => {
        const destination = destinations.get(route.key) ?? { x: factory.x, y: factory.y };
        return {
          route,
          ...createScreenArc({ x: factory.x, y: factory.y }, destination),
          // 错峰 0.06s：整屏读起来是一条呼吸节奏
          delay: `${(index * 0.06).toFixed(2)}s`,
          color: "var(--c-collect)",
          duration: `${(2.6 + (index % 5) * 0.18).toFixed(2)}s`,
          destination,
        };
      }),
    [routes, destinations, factory.x, factory.y],
  );

  const labels = useMemo(() => {
    const cityRoutes = new Map<string, PublicRouteSample>();
    for (const route of routes) {
      if (route.city !== null && !cityRoutes.has(route.city)) cityRoutes.set(route.city, route);
    }
    const cities = [...cityRoutes.values()].map((route) => {
      const destination = destinations.get(route.key) ?? { x: factory.x, y: factory.y };
      return {
        id: `city-${route.city}`,
        text: route.city as string,
        x: destination.x,
        y: destination.y,
        size: LABEL_SIZES.city,
        cls: "map-label-city",
        fill: "#f6fbff",
      };
    });

    // 先放有数据的省，再放其余；同级内从西到东 —— 给东部密集区留余量
    const provinceItems = provinces
      .filter((province) => province.label)
      .map((province) => ({
        province,
        count: heat.counts.get(matchProvinceKey(province.name)) || 0,
      }))
      .sort(
        (a, b) =>
          Number(b.count > 0) - Number(a.count > 0) ||
          a.province.x - b.province.x ||
          a.province.y - b.province.y,
      )
      .map(({ province, count }) => ({
        id: `prov-${province.adcode}`,
        text: province.short,
        x: province.x,
        y: province.y,
        size: LABEL_SIZES.province,
        cls: "map-label",
        fill: count > 0 ? "#ffe6cc" : "#a9b6c8",
      }));

    const neighborItems = neighbors
      .filter((item) => item.x !== undefined && item.y !== undefined)
      .map((item) => ({
        id: `nb-${item.name}`,
        text: item.name,
        x: item.x as number,
        y: item.y as number,
        size: LABEL_SIZES.neighbor,
        cls: "map-label-neighbor",
        fill: NEIGHBOR_LABEL_FILL[Math.min(2, item.order)],
      }));

    return placeLabels([{ items: cities }, { items: provinceItems }, { items: neighborItems }]);
  }, [heat, neighbors, provinces, routes, destinations, factory.x, factory.y]);

  /** 省级排行：样本热度对比，填满地图左侧空白 */
  const provinceRanking = useMemo(() => {
    const counts = new Map<string, number>();
    for (const route of routes) {
      const name = matchProvinceKey(route.province);
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
  }, [routes]);

  const maxRank = provinceRanking[0]?.count ?? 1;

  // 视口几何：面板边框盒 - 1px 边框 = 内容区，中国本土按内容区居中
  const viewport = computeMapViewport(mapBox.width - 2, mapBox.height - 2);
  const svgPlacement = {
    position: "absolute" as const,
    left: viewport.left,
    top: viewport.top,
    width: viewport.width,
    height: viewport.height,
  };
  // CSS 变量 --inv-k / --inv-sk：放大后 CSS 类描边按它们反向补偿（见 sales-screen.css）
  const zoomSvgStyle = {
    ...svgPlacement,
    "--inv-k": invK,
    "--inv-sk": invSk,
  } as React.CSSProperties;

  return (
    <div className="relative h-full overflow-hidden">
      <div className="map-titlebar pointer-events-none absolute top-0 right-0 left-0 z-10 flex items-center justify-between px-5 py-4">
        <div>
          <p className="panel-eyebrow">NATIONAL DELIVERY NETWORK</p>
          <h2 className="screen-text-label mt-1.5 leading-none font-bold tracking-[0.08em] text-[var(--ink)]">
            全国交付态势
          </h2>
        </div>
        <div className="flex items-center gap-7 text-right">
          <div>
            <p className="screen-text-micro leading-none text-[var(--ink-3)]">交付路线</p>
            <p className="num screen-text-label mt-1.5 leading-none text-[var(--ink)]">
              {formatCount(summary.shipmentCount)}
            </p>
          </div>
          <div>
            <p className="screen-text-micro leading-none text-[var(--ink-3)]">覆盖省份</p>
            <p className="num screen-text-label mt-1.5 leading-none text-[var(--c-collect)]">
              {formatCount(summary.regionCount)}
            </p>
          </div>
          <div>
            <p className="screen-text-micro leading-none text-[var(--ink-3)]">交付台数</p>
            <p className="num screen-text-label mt-1.5 leading-none text-[var(--c-received)]">
              {formatCount(summary.unitCount)}
            </p>
          </div>
        </div>
      </div>

      {/* SVG 视口由纯函数 computeMapViewport 给出：中国本土在任意面板尺寸下都居中，
          默认 880 面板下与冻结版缩放系数一致（仍由宽度定标）。
          底层是静态背景（球面光环 + 球面明暗），上层是可缩放的地理要素层。 */}
      <div className="absolute inset-0 flex">
        <svg
          className="map-svg"
          style={svgPlacement}
          viewBox={mapViewBox}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
          pointerEvents="none"
        >
        <defs>
          {/* 边缘光：模糊副本叠在原图下方（球面光环 glow 用） */}
          <filter id="edge-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4.5" />
          </filter>

          {/* 球面明暗：左上受光、右下入暗。覆盖整幅画布，角落不会出现硬边。 */}
          <radialGradient id="sphere-shade" cx="38%" cy="30%" r="86%">
            <stop offset="0%" stopColor="rgba(96, 150, 210, 0.11)" />
            <stop offset="46%" stopColor="rgba(14, 22, 34, 0)" />
            <stop offset="100%" stopColor="rgba(2, 5, 10, 0.62)" />
          </radialGradient>
        </defs>

        {/* ---- 球面光环：画布级背景，静态 viewBox，不随缩放变形 ---- */}
        <g pointerEvents="none">
          {sphereRings.map((ring) => (
            <ellipse
              key={ring.scale}
              className={ring.glow ? "map-sphere-ring map-sphere-ring-glow" : "map-sphere-ring"}
              cx={sphereCenter.x}
              cy={sphereCenter.y}
              rx={(chinaMap.width / 2) * ring.scale}
              ry={(chinaMap.height / 2) * ring.scale}
              strokeWidth={ring.width}
              strokeOpacity={ring.opacity}
              strokeDasharray={ring.dash}
            />
          ))}

          {/* 球面明暗：整幅画布，角落不留硬边 */}
          <rect x="0" y="0" width={chinaMap.width} height={chinaMap.height} fill="url(#sphere-shade)" />
        </g>
        </svg>

        <svg
          className="map-svg"
          ref={svgRef}
          style={zoomSvgStyle}
          viewBox={zoomViewBoxAttr(zoom)}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="全国交付态势地图"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={onDoubleClick}
        >
        <defs>
          <filter id="edge-glow-tight" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.8" />
          </filter>
          <filter id="arc-glow" x="-36%" y="-36%" width="172%" height="172%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="node-glow" x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* 顶面光照：左下暖、右上冷 */}
          <linearGradient id="terrain-light" x1="0" y1="1" x2="0.85" y2="0">
            <stop offset="0%" stopColor="rgba(255, 168, 96, 0.16)" />
            <stop offset="38%" stopColor="rgba(255, 168, 96, 0.04)" />
            <stop offset="72%" stopColor="rgba(8, 12, 20, 0.16)" />
            <stop offset="100%" stopColor="rgba(3, 6, 12, 0.42)" />
          </linearGradient>

          <radialGradient id="factory-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="34%" stopColor="#9df3ff" />
            <stop offset="100%" stopColor="rgba(69, 216, 238, 0)" />
          </radialGradient>

          {/* 中国整体外发光：让边缘光有「溢出来」的感觉 */}
          <filter id="china-outer-glow" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="7" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="b" />
            </feMerge>
          </filter>
        </defs>

          {/* 经纬网：地理要素，留在缩放层，随 viewBox 一起缩放 */}
          <g className="map-graticule" fill="none" stroke="var(--c-graticule)" strokeWidth={1.1 * invSk}>
            {chinaMap.graticule.parallels.map((line) => (
              <path
                key={`p-${line.lat}`}
                className={line.emphasis ? "map-graticule-emphasis" : undefined}
                d={line.d}
              />
            ))}
            {chinaMap.graticule.meridians.map((line) => (
              <path
                key={`m-${line.lon}`}
                className={line.emphasis ? "map-graticule-emphasis" : undefined}
                d={line.d}
              />
            ))}
          </g>

        {/* ---- 邻国（由近到远逐级变淡，构成球面纵深） ---- */}
        <g pointerEvents="none">
          {[0, 1, 2].map((order) => (
            <g key={`order-${order}`}>
              {neighbors
                .filter((item) => item.order === order)
                .map((item) => (
                  <path key={item.name} className="map-neighbor" d={item.d} fill={NEIGHBOR_FILL[order]} />
                ))}
            </g>
          ))}
        </g>

        {/* ---- 邻国一级行政区纹理线：低透明度，只给色块加地理质感，
             画在邻国之上、中国之下，不与省界/国界抢 ---- */}
        <g pointerEvents="none" fill="none">
          {neighborAdminLines.map((line) => (
            <path key={line.key} className="map-neighbor-admin" d={line.d} />
          ))}
        </g>

        {/* ---- 中国：省级顶面 ---- */}
        <g>
          {provinces.map((province) => {
            const count = heat.counts.get(matchProvinceKey(province.name)) || 0;
            return (
              <path
                key={province.adcode}
                className="map-province"
                d={province.d}
                fill={HEAT_SCALE[heatIndex(count, heat.max)]}
              />
            );
          })}
        </g>

        {/* ---- 中国顶面光照 ---- */}
        <g pointerEvents="none">
          <path d={chinaSilhouette} fill="url(#terrain-light)" />
        </g>

        {/* ---- 中国边缘光：外发光 + 暖色描边 + 亮芯 ---- */}
        <g pointerEvents="none">
          <path
            d={chinaSilhouette}
            className="map-china-edge-warm"
            strokeWidth={6 * invK}
            filter="url(#china-outer-glow)"
          />
          <path
            d={chinaSilhouette}
            className="map-china-edge-core"
            strokeWidth={3 * invK}
            filter="url(#edge-glow-tight)"
          />
          <path d={chinaSilhouette} className="map-china-edge-core" strokeWidth={1.5 * invK} />
        </g>

        {/* ---- 标签 ---- */}
        <g pointerEvents="none">
          {labels.map((label) => (
            <text
              key={label.id}
              className={label.cls}
              x={label.x}
              y={label.y}
              fontSize={label.size * invK}
              textAnchor={label.anchor}
              fill={label.fill}
            >
              {label.text}
            </text>
          ))}
        </g>

        {/* ---- 航线（halo/core/flow 三层，密度自适应基础透明度） ---- */}
        <g>
          {arcs.map((arc) => {
            const isActive = active?.key === arc.route.key;
            return (
              <g key={arc.route.key}>
                <path d={arc.d} className="map-arc" stroke={arc.color} strokeOpacity={0.1} strokeWidth={7 * invK} />
                <path
                  d={arc.d}
                  className="map-arc"
                  stroke={arc.color}
                  strokeOpacity={isActive ? ARC_ACTIVE_OPACITY : arcOpacity.core}
                  strokeWidth={(isActive ? 3 : 2) * invK}
                  filter="url(#arc-glow)"
                />
                <path
                  className="map-flow"
                  d={arc.d}
                  stroke={arc.color}
                  strokeOpacity={isActive ? 0.9 : arcOpacity.flow}
                  strokeWidth={2.6 * invK}
                  style={{ animationDuration: arc.duration, animationDelay: arc.delay }}
                />
              </g>
            );
          })}
        </g>

        {/* ---- 收货点（省/市中心扇形散开后，非客户真实位置） ---- */}
        <g>
          {arcs.map((arc) => {
            const isActive = active?.key === arc.route.key;
            return (
              <g
                key={arc.route.key}
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                focusable="true"
                aria-label={`${arc.route.city ?? arc.route.province}交付节点`}
                onClick={() => {
                  // 拖拽后的 click 不算选择，节点高亮不被平移破坏
                  if (suppressClickRef.current) return;
                  setActiveId(arc.route.key);
                }}
                onFocus={() => setActiveId(arc.route.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActiveId(arc.route.key);
                  }
                }}
                onMouseEnter={() => setActiveId(arc.route.key)}
              >
                <circle cx={arc.destination.x} cy={arc.destination.y} r={17 * invK} fill="transparent" />
                {isActive ? (
                  <circle
                    cx={arc.destination.x}
                    cy={arc.destination.y}
                    r={11 * invK}
                    fill="none"
                    stroke={arc.color}
                    strokeOpacity="0.45"
                    strokeWidth={1.4 * invK}
                  />
                ) : null}
                <circle
                  className="map-node"
                  cx={arc.destination.x}
                  cy={arc.destination.y}
                  r={(isActive ? 6.6 : 4.9) * invK}
                  fill="#050a12"
                  stroke={arc.color}
                  strokeWidth={(isActive ? 3 : 2.4) * invK}
                  filter="url(#node-glow)"
                />
              </g>
            );
          })}
        </g>

        {/* ---- 工厂：全图唯一视觉锚点 ---- */}
        <g pointerEvents="none">
          <circle
            className="factory-core"
            cx={factory.x}
            cy={factory.y}
            r={54 * invK}
            fill="none"
            stroke="rgba(69, 216, 238, 0.28)"
            strokeWidth={1.2 * invK}
            strokeDasharray="3 7"
          />
          <circle
            cx={factory.x}
            cy={factory.y}
            r={36 * invK}
            fill="none"
            stroke="rgba(69, 216, 238, 0.4)"
            strokeWidth={1.4 * invK}
          />
          <circle cx={factory.x} cy={factory.y} fill="url(#factory-core)" r={30 * invK} />
          <circle
            cx={factory.x}
            cy={factory.y}
            r={7 * invK}
            fill="#eafcff"
            stroke="var(--c-collect)"
            strokeWidth={2.4 * invK}
            filter="url(#node-glow)"
          />
        </g>
      </svg>
      </div>

      {/* ================= 两侧数据角标 =================
          左侧：发货来源 + 省级排行；右侧：省级发货量色阶图例。
          卡片半透明，压在邻国上也不会显得「糊住」。 */}

      <div className="pointer-events-none absolute top-[92px] left-3 z-10 flex w-[150px] flex-col gap-2">
        <div className="map-hud px-2.5 py-2">
          <p className="screen-text-micro leading-none tracking-[0.14em] text-[var(--ink-3)]">发货来源</p>
          <p className="screen-text-caption mt-1.5 leading-tight font-bold text-[var(--ink)]">滕州工厂</p>
          <p className="screen-text-micro mt-1 leading-none text-[var(--ink-3)]">山东 · 滕州</p>
        </div>

        <div className="map-hud px-2.5 py-2">
          <p className="screen-text-micro leading-none tracking-[0.14em] text-[var(--ink-3)]">省级排行</p>
          <ul className="mt-1.5 space-y-1.5">
            {provinceRanking.slice(0, 4).map((row) => (
              <li key={row.name}>
                <div className="flex items-baseline justify-between gap-1.5">
                  <span className="screen-text-micro truncate leading-none text-[var(--ink-2)]">
                    {row.name}
                  </span>
                  <span className="num screen-text-micro leading-none text-[var(--ink)]">{formatCount(row.count)}</span>
                </div>
                <span
                  className="mt-1 block h-1 rounded-full"
                  style={{
                    width: `${Math.max(14, (row.count / maxRank) * 100)}%`,
                    background: HEAT_SCALE[Math.min(HEAT_LEVELS - 1, 2 + row.count)],
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="pointer-events-none absolute top-[92px] right-3 z-10 flex w-[150px] flex-col gap-2">
        {/* 高度色阶图例：带刻度（max 为样本口径，仅作图例） */}
        <div className="map-hud px-2.5 py-2">
          <p className="screen-text-micro leading-none tracking-[0.14em] text-[var(--ink-3)]">省级发货量</p>
          <div className="mt-1.5 flex items-end gap-[3px]">
            {HEAT_SCALE.map((color, index) => (
              <span
                key={color}
                className="block flex-1 rounded-[2px]"
                style={{ background: color, height: `${9 + index * 4}px` }}
              />
            ))}
          </div>
          <div className="screen-text-micro mt-1.5 flex justify-between leading-none text-[var(--ink-3)]">
            <span>0</span>
            <span className="num text-[var(--brand-orange-hot)]">{formatCount(heat.max)} 单</span>
          </div>
        </div>
      </div>
    </div>
  );
}
