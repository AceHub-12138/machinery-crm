import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  arcBaseOpacities,
  arcDensityFactor,
  compensationFactors,
  baseMapZoom,
  chinaMap,
  fanOutRouteEnds,
  hashRouteKey,
  MAP_IDLE_RESET_MS,
  MAP_ZOOM_MAX,
  MAP_ZOOM_MIN,
  neighborAdminLines,
  panZoom,
  wheelZoomFactor,
  zoomAt,
  zoomScale,
  zoomViewBoxAttr,
} from "./geo";
import { CURSOR_IDLE_HIDE_MS, cursorIdleSnapshot } from "./cursor-idle";
import { SalesScreenBoard } from "./SalesScreenBoard";
import { ShipmentMap } from "./ShipmentMap";
import {
  buildPublicSalesScreenPayloadFixture,
} from "@/modules/screen/sales-screen-payload.fixture";

const fixture = buildPublicSalesScreenPayloadFixture();

describe("map zoom pure functions", () => {
  const base = baseMapZoom();

  it("clamps the zoom factor into the 1×–5× window", () => {
    expect(MAP_ZOOM_MIN).toBe(1);
    expect(MAP_ZOOM_MAX).toBe(5);

    // 放大再猛也封顶 5×
    const maxed = zoomAt(base, 600, 400, 50);
    expect(zoomScale(maxed)).toBeCloseTo(5, 6);
    // 连续放大同样封顶
    const stepwise = zoomAt(zoomAt(zoomAt(base, 600, 400, 2), 600, 400, 2), 600, 400, 2);
    expect(zoomScale(stepwise)).toBeCloseTo(5, 6);
    // 缩小到底就是全图：窗口与基础 viewBox 重合
    const reset = zoomAt(zoomAt(base, 600, 400, 3), 600, 400, 0.01);
    expect(zoomScale(reset)).toBeCloseTo(1, 6);
    expect(reset).toEqual(base);
    // w/h 同因子：纵横比与基础 viewBox 一致
    expect(maxed.w / maxed.h).toBeCloseTo(base.w / base.h, 2);
  });

  it("keeps the geographic point under the cursor fixed while zooming", () => {
    const anchors = [
      { x: 700, y: 300 },
      { x: 200, y: 800 },
      { x: 1100, y: 100 },
    ];
    for (const anchor of anchors) {
      for (const factor of [1.4, 2.5, 0.6]) {
        const zoomed = zoomAt(base, anchor.x, anchor.y, factor);
        // 锚点在窗口中的相对位置缩放前后必须一致（光标下的地理点不动）
        const beforeX = (anchor.x - base.x) / base.w;
        const beforeY = (anchor.y - base.y) / base.h;
        const afterX = (anchor.x - zoomed.x) / zoomed.w;
        const afterY = (anchor.y - zoomed.y) / zoomed.h;
        expect(afterX).toBeCloseTo(beforeX, 4);
        expect(afterY).toBeCloseTo(beforeY, 4);
      }
    }
  });

  it("never pans the window outside the base viewBox", () => {
    const zoomed = zoomAt(base, 600, 462, 3);
    // 朝任意方向狂拖都被 clamp 在基础 viewBox 内
    for (const [dx, dy] of [
      [9999, 0],
      [-9999, 0],
      [0, 9999],
      [0, -9999],
      [9999, 9999],
    ]) {
      const panned = panZoom(zoomed, dx, dy);
      expect(panned.x).toBeGreaterThanOrEqual(0);
      expect(panned.y).toBeGreaterThanOrEqual(0);
      expect(panned.x + panned.w).toBeLessThanOrEqual(chinaMap.width);
      expect(panned.y + panned.h).toBeLessThanOrEqual(chinaMap.height);
    }
    // 全图（k=1）没有可平移的余地
    expect(panZoom(base, 120, 80)).toEqual(base);
    // 窗口大小不因平移改变
    const moved = panZoom(zoomed, 10, -10);
    expect(moved.w).toBe(zoomed.w);
    expect(moved.h).toBe(zoomed.h);
  });

  it("maps wheel direction to zoom in/out and keeps the 90s reset budget", () => {
    expect(wheelZoomFactor(-120)).toBeGreaterThan(1);
    expect(wheelZoomFactor(120)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
    expect(MAP_IDLE_RESET_MS).toBe(90_000);
    expect(zoomViewBoxAttr(base)).toBe(`0 0 ${chinaMap.width} ${chinaMap.height}`);
  });
});

describe("route endpoint fan-out", () => {
  it("spreads same-destination routes deterministically within a 10-unit ring", () => {
    const center = { x: 800, y: 430 };
    const routes = Array.from({ length: 24 }, (_, index) => ({
      key: `shandong-${index}`,
      x: center.x,
      y: center.y,
    }));

    const fanned = fanOutRouteEnds(routes);
    const again = fanOutRouteEnds(routes);
    // 同一输入必须同一输出（顺序无关的确定性）
    expect([...fanned.entries()]).toEqual([...again.entries()]);

    // 全部离开原点、半径封顶 10 画布单位
    for (const point of fanned.values()) {
      const distance = Math.hypot(point.x - center.x, point.y - center.y);
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThanOrEqual(10.01);
    }

    // 环上两两不重叠：24 条的最小间距 ≈ 2.5 单位
    const points = [...fanned.values()];
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        expect(Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y)).toBeGreaterThan(0.5);
      }
    }
  });

  it("keeps solo destinations and mixed buckets intact", () => {
    const solo = fanOutRouteEnds([{ key: "a", x: 12, y: 34 }]);
    expect(solo.get("a")).toEqual({ x: 12, y: 34 });

    // 同一坐标只散开同桶，别处不动
    const mixed = fanOutRouteEnds([
      { key: "a", x: 100, y: 100 },
      { key: "b", x: 100, y: 100 },
      { key: "c", x: 300, y: 200 },
    ]);
    expect(mappedDistance(mixed, "a", 100, 100)).toBeGreaterThan(0);
    expect(mappedDistance(mixed, "b", 100, 100)).toBeGreaterThan(0);
    expect(mixed.get("c")).toEqual({ x: 300, y: 200 });
  });

  it("derives stable phases from the route key hash", () => {
    expect(hashRouteKey("route-1")).toBe(hashRouteKey("route-1"));
    expect(hashRouteKey("route-1")).not.toBe(hashRouteKey("route-2"));
    // 32 位无符号范围
    for (const key of ["a", "shandong-7", "x".repeat(43)]) {
      expect(hashRouteKey(key)).toBeGreaterThanOrEqual(0);
      expect(hashRouteKey(key)).toBeLessThanOrEqual(0xffffffff);
    }
  });

  function mappedDistance(
    map: Map<string, { x: number; y: number }>,
    key: string,
    x: number,
    y: number,
  ) {
    const point = map.get(key);
    expect(point).toBeDefined();
    return Math.hypot(point!.x - x, point!.y - y);
  }
});

describe("neighbour admin-1 texture lines", () => {
  it("ships in-canvas interior boundaries for the rendered neighbours", () => {
    expect(neighborAdminLines.length).toBeGreaterThanOrEqual(20);
    const keys = neighborAdminLines.map((line) => line.key);
    expect(new Set(keys).size).toBe(keys.length);
    // 蒙古/俄罗斯是「单调色块」的主因，必须有纹理线
    expect(keys).toContain("蒙古");
    expect(keys).toContain("俄罗斯");
    for (const line of neighborAdminLines) {
      expect(line.d.startsWith("M")).toBe(true);
      expect(line.d).not.toContain("NaN");
      // 每个坐标都落在画布内
      for (const match of line.d.matchAll(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g)) {
        const x = Number(match[1]);
        const y = Number(match[2]);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(chinaMap.width);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(chinaMap.height);
      }
    }
  });

  it("renders the texture layer beneath the China provinces", () => {
    const html = renderToStaticMarkup(
      <ShipmentMap
        routes={fixture.delivery.routes}
        summary={fixture.delivery.summary}
        mapBox={{ width: 880, height: 838 }}
      />,
    );
    expect(html).toContain("map-neighbor-admin");
    // 纹理线先渲染，中国省份后渲染 = 中国盖在纹理线之上
    expect(html.indexOf("map-neighbor-admin")).toBeLessThan(html.indexOf("map-province"));
  });
});

describe("zoom compensation factors", () => {
  it("keeps glow constant with 1/k and lets detail lines grow with 1/√k", () => {
    expect(compensationFactors(baseMapZoom())).toEqual({ invK: 1, invSk: 1 });
    const zoomed = zoomAt(baseMapZoom(), 600, 400, 4);
    const { invK, invSk } = compensationFactors(zoomed);
    expect(invK).toBeCloseTo(0.25, 3);
    expect(invSk).toBeCloseTo(0.5, 3);
  });
});

describe("density-adaptive arc opacity", () => {
  it("keeps the frozen base opacity at or below 24 routes", () => {
    for (const count of [1, 24]) {
      expect(arcBaseOpacities(new Array(count)).core).toBeCloseTo(0.42, 3);
      expect(arcBaseOpacities(new Array(count)).flow).toBeCloseTo(0.5, 3);
    }
    expect(arcDensityFactor(24)).toBe(1);
  });

  it("fades long-route boards along the √(24/n) curve", () => {
    // n=96 → √0.25 = 0.5
    expect(arcBaseOpacities(new Array(96)).core).toBeCloseTo(0.21, 3);
    expect(arcBaseOpacities(new Array(96)).flow).toBeCloseTo(0.25, 3);
  });

  it("floors the factor at 0.35 so arcs never vanish", () => {
    const floored = arcBaseOpacities(new Array(10_000));
    expect(arcDensityFactor(196)).toBeCloseTo(0.35, 6);
    expect(floored.core).toBeCloseTo(0.42 * 0.35, 3);
    expect(floored.flow).toBeCloseTo(0.5 * 0.35, 3);
  });

  it("decreases monotonically past the threshold", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const count of [24, 30, 48, 96, 150, 196, 500]) {
      const core = arcBaseOpacities(new Array(count)).core;
      expect(core).toBeLessThanOrEqual(previous);
      previous = core;
    }
  });
});

describe("cursor idle state machine", () => {
  it("hides after exactly 3s of stillness and shows on any movement", () => {
    expect(CURSOR_IDLE_HIDE_MS).toBe(3000);

    // 刚移动过：可见（「从未移动」的初始闲置由组件初始态负责，见 kiosk 属性测试）
    expect(cursorIdleSnapshot(0, 0).idle).toBe(false);

    const hidden = cursorIdleSnapshot(3000, 0);
    expect(hidden.idle).toBe(true);
    expect(hidden.msUntilHide).toBe(0);

    // 2999ms 时仍可见，还剩 1ms
    const shown = cursorIdleSnapshot(2999, 0);
    expect(shown.idle).toBe(false);
    expect(shown.msUntilHide).toBe(1);

    // 移动重置计时：距最后一次移动 1s，仍可见
    expect(cursorIdleSnapshot(5000, 4000).idle).toBe(false);

    // 时钟回拨不允许出现负数
    expect(cursorIdleSnapshot(1000, 5000).msUntilHide).toBe(3000);
  });
});

describe("r1 screen shell integration", () => {
  it("marks kiosk cursor idle on the root only in kiosk mode", () => {
    const kioskHtml = renderToStaticMarkup(
      <SalesScreenBoard initialPayload={fixture} publicId={"x".repeat(43)} kiosk />,
    );
    expect(kioskHtml).toContain('data-kiosk="1"');
    // 初始即闲置：LED 静置时无光标
    expect(kioskHtml).toContain('data-cursor-idle="1"');

    const normalHtml = renderToStaticMarkup(
      <SalesScreenBoard initialPayload={fixture} publicId={"x".repeat(43)} />,
    );
    expect(normalHtml).not.toContain("data-kiosk");
    expect(normalHtml).not.toContain("data-cursor-idle");
  });

  it("renders the zoomable map with the base viewBox and the inverse-scale variable", () => {
    const html = renderToStaticMarkup(
      <ShipmentMap
        routes={fixture.delivery.routes}
        summary={fixture.delivery.summary}
        mapBox={{ width: 880, height: 838 }}
      />,
    );
    // 初始 viewBox = 全图；CSS 变量随 svg 根下发（默认 1 倍）
    expect(html).toContain('viewBox="0 0 1204 924"');
    expect(html).toContain("--inv-k");
    expect(html).toContain("--inv-sk");
    // 静态背景层（球面光环）与地理要素层都在
    expect(html).toContain("map-sphere-ring");
    expect(html).toContain("map-province");
    expect(html).toContain("map-flow");
  });
});
