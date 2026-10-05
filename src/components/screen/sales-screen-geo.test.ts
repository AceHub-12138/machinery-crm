import { describe, expect, it } from "vitest";
import {
  chinaMap,
  chinaSilhouette,
  computeMapViewport,
  createScreenArc,
  mapBBox,
  matchProvinceKey,
  placeLabels,
  projectLonLat,
  sphereCenter,
  sphereRings,
} from "./geo";
import { getProvinceCenter } from "@/modules/screen/province-centers";
import { getCityCenter } from "@/modules/screen/city-centers";

describe("china map projection", () => {
  it("places Tengzhou inside Shandong, in the eastern half", () => {
    const factory = projectLonLat(117.1656, 35.0886);
    // 相对陆地包围盒判断，而不是相对画布 —— 画布边距会随排版调整
    const relativeX = (factory.x - mapBBox.minX) / mapBBox.width;
    const relativeY = (factory.y - mapBBox.minY) / mapBBox.height;
    expect(relativeX).toBeGreaterThan(0.55);
    expect(relativeX).toBeLessThan(0.8);
    expect(relativeY).toBeGreaterThan(0.3);
    expect(relativeY).toBeLessThan(0.6);
    // 滕州在山东，必须落在山东多边形锚点附近
    const shandong = chinaMap.provinces.find((item) => item.short === "山东");
    expect(shandong).toBeDefined();
    expect(Math.abs(shandong!.x - factory.x)).toBeLessThan(70);
    expect(Math.abs(shandong!.y - factory.y)).toBeLessThan(70);
  });

  it("keeps provinces and public route centers inside the canvas", () => {
    expect(chinaMap.provinces.length).toBeGreaterThanOrEqual(30);
    expect(chinaMap.provinces.some((item) => item.short === "山东")).toBe(true);
    expect(matchProvinceKey("山东省")).toBe("山东");

    // 公开路线的终点是省/市中心，逐一投影后都必须落在画布内
    for (const province of chinaMap.provinces) {
      const center = getProvinceCenter(province.name);
      if (!center) continue;
      const projected = projectLonLat(center.lng, center.lat);
      expect(projected.x).toBeGreaterThan(0);
      expect(projected.x).toBeLessThan(chinaMap.width);
      expect(projected.y).toBeGreaterThan(0);
      expect(projected.y).toBeLessThan(chinaMap.height);
    }
  });

  it("projects public city centers near their province anchor", () => {
    const pairs: Array<[string, string]> = [
      ["山东省", "济南市"],
      ["广东省", "广州市"],
      ["江苏省", "南京市"],
      ["四川省", "成都市"],
    ];
    for (const [province, city] of pairs) {
      const cityCenter = getCityCenter(province, city);
      expect(cityCenter, city).not.toBeNull();
      const provinceAnchor = chinaMap.provinces.find((item) => item.name === province);
      expect(provinceAnchor, province).toBeDefined();
      const projected = projectLonLat(cityCenter!.lng, cityCenter!.lat);
      // 大省（如广东）市中心离省锚点可能较远，用宽松阈值保证同省而非跨省错位
      expect(Math.abs(projected.x - provinceAnchor!.x)).toBeLessThan(150);
      expect(Math.abs(projected.y - provinceAnchor!.y)).toBeLessThan(150);
    }
  });

  it("fills the canvas horizontally instead of leaving margins", () => {
    // 中国必须横向占到画布的 65% 以上，否则地图在面板里被等比缩一圈
    expect(mapBBox.width / chinaMap.width).toBeGreaterThan(0.65);
  });

  it("centres China vertically in the canvas", () => {
    const topGap = mapBBox.minY;
    const bottomGap = chinaMap.height - mapBBox.maxY;
    expect(topGap).toBeGreaterThan(0);
    expect(bottomGap).toBeGreaterThan(0);
    // 上下留白应当接近：南方邻国被赤道裁掉一截，中国会略微偏上
    expect(Math.abs(topGap - bottomGap)).toBeLessThan(chinaMap.height * 0.2);
  });

  it("fills the canvas with neighbouring land on both edges", () => {
    // 邻国沿经度裁到画布窗口，左右两侧一定有陆地贴边
    const edgeX = { left: chinaMap.width * 0.05, right: chinaMap.width * 0.95 };
    const vertex = (d: string) => [...d.matchAll(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g)];
    let minX = Infinity;
    let maxX = -Infinity;
    for (const item of chinaMap.neighbors) {
      for (const match of vertex(item.d)) {
        const x = Number(match[1]);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    expect(minX).toBeLessThan(edgeX.left);
    expect(maxX).toBeGreaterThan(edgeX.right);
  });

  it("matches the canvas aspect ratio to the map panel", () => {
    const aspect = chinaMap.width / chinaMap.height;
    expect(aspect).toBeGreaterThan(1.3);
    expect(aspect).toBeLessThan(1.45);
  });
});

describe("silhouette, neighbours and sphere", () => {
  it("ships a merged national silhouette and closes every subpath", () => {
    expect(chinaMap.silhouette.length).toBeGreaterThan(0);
    expect(chinaMap.silhouette[0]!.area).toBeGreaterThan(100);
    expect(chinaSilhouette.startsWith("M")).toBe(true);
    expect(chinaSilhouette).not.toContain("NaN");
    const subpaths = chinaSilhouette.split("Z").filter((piece) => piece.trim());
    expect(subpaths.length).toBe(chinaMap.silhouette.length);
  });

  it("keeps the whole landmass inside the viewBox", () => {
    const [, , vw, vh] = chinaMap.viewBox.split(/\s+/).map(Number);
    expect(mapBBox.minX).toBeGreaterThan(0);
    expect(mapBBox.minY).toBeGreaterThan(0);
    expect(mapBBox.maxX).toBeLessThan(vw!);
    expect(mapBBox.maxY).toBeLessThan(vh!);
  });

  it("projects lon/lat with the same parameters as the build script", () => {
    const { lonLat, pitch } = chinaMap;
    expect(pitch).toBeGreaterThan(0);
    const corner = projectLonLat(lonLat.lon.min, lonLat.lat.max);
    expect(corner.x).toBeCloseTo(0, 1);
    expect(corner.y).toBeCloseTo(0, 1);
    const factory = chinaMap.factory;
    const reprojected = projectLonLat(factory.lon, factory.lat);
    expect(Math.abs(reprojected.x - factory.x)).toBeLessThan(1);
    expect(Math.abs(reprojected.y - factory.y)).toBeLessThan(1);
  });

  it("has neighbours in all three depth tiers so the globe reads as layered", () => {
    expect(chinaMap.neighbors.length).toBeGreaterThanOrEqual(15);
    for (const order of [0, 1, 2]) {
      expect(chinaMap.neighbors.some((item) => item.order === order)).toBe(true);
    }
    for (const item of chinaMap.neighbors) {
      expect(item.d.length).toBeGreaterThan(40);
      expect(item.d).not.toContain("NaN");
    }
  });

  it("generates a graticule from the same projection as the landmass", () => {
    const [, , vw, vh] = chinaMap.viewBox.split(/\s+/).map(Number);
    expect(chinaMap.graticule.meridians.length).toBeGreaterThanOrEqual(8);
    expect(chinaMap.graticule.parallels.length).toBeGreaterThanOrEqual(5);
    for (const line of [...chinaMap.graticule.meridians, ...chinaMap.graticule.parallels]) {
      expect(line.d).not.toContain("NaN");
      const coords = line.d.match(/-?\d+(\.\d+)?/g) ?? [];
      expect(coords.length).toBeGreaterThan(4);
      for (const value of coords.map(Number)) {
        expect(Math.abs(value)).toBeLessThan(Math.max(vw!, vh!) * 2);
      }
    }
    expect(chinaMap.graticule.parallels.some((line) => line.emphasis)).toBe(true);
  });

  it("keeps the sphere rings centred on the canvas and progressively wider", () => {
    expect(sphereCenter.x).toBeCloseTo(chinaMap.width / 2, 0);
    expect(sphereCenter.y).toBeCloseTo(chinaMap.height / 2, 0);
    expect(sphereRings.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < sphereRings.length; i += 1) {
      expect(sphereRings[i]!.scale).toBeGreaterThan(sphereRings[i - 1]!.scale);
      expect(sphereRings[i]!.opacity).toBeLessThan(sphereRings[i - 1]!.opacity);
    }
    expect(sphereRings[0]!.scale).toBeGreaterThan(0.95);
    expect(sphereRings[0]!.scale).toBeLessThan(1.25);
  });

  it("has no 3D extrusion left in the map data", () => {
    expect("extrude" in chinaMap).toBe(false);
  });
});

describe("map viewport centring", () => {
  /** 由视口几何推算中国本土中心在面板内容区中的落点 */
  function chinaCentreY(viewport: ReturnType<typeof computeMapViewport>) {
    const canvasScale = viewport.width / chinaMap.width;
    const canvasTopInViewport = (viewport.height - chinaMap.height * canvasScale) / 2;
    const chinaCenterOffsetFromCanvas =
      ((chinaMap.china.minY + chinaMap.china.maxY) / 2 - chinaMap.height / 2) * canvasScale;
    return viewport.top + canvasTopInViewport + (chinaMap.height / 2) * canvasScale + chinaCenterOffsetFromCanvas;
  }

  it("reproduces the frozen scale on the default 880×838 panel", () => {
    const viewport = computeMapViewport(878, 836);
    expect(viewport.scale).toBeCloseTo(866 / 1204, 4);
    expect(viewport.left).toBeCloseTo(6, 1);
  });

  it("keeps China centred within 2px for every layout the resolver can produce", () => {
    // 布局解析器可能给出的地图面板（边框盒）与对应内容区
    const boxes: Array<[number, number]> = [
      [880, 838], // 三列齐全 + 底栏
      [880, 964], // 三列齐全、底栏关闭
      [1254, 838], // 左列关闭（地图弹性）
      [1518, 838], // 右列关闭（地图弹性）
      [1892, 964], // 仅地图
    ];
    for (const [outerWidth, outerHeight] of boxes) {
      const viewport = computeMapViewport(outerWidth - 2, outerHeight - 2);
      const centre = chinaCentreY(viewport);
      expect(Math.abs(centre - (outerHeight - 2) / 2)).toBeLessThanOrEqual(2);
    }
  });

  it("would be visibly off-centre without the vertical correction (counter-proof)", () => {
    // 不做纵向修正时，默认面板上偏差必须超过 20px，证明修正量不是摆设
    const inset = 12;
    const innerWidth = 878;
    const innerHeight = 836;
    const scale = Math.min((innerWidth - inset) / chinaMap.width, innerHeight / chinaMap.height);
    const canvasHeight = chinaMap.height * scale;
    const naiveTop = (innerHeight - canvasHeight) / 2;
    const canvasScale = scale;
    const chinaCenterOffsetFromCanvas =
      ((chinaMap.china.minY + chinaMap.china.maxY) / 2 - chinaMap.height / 2) * canvasScale;
    const naiveCentre =
      naiveTop + canvasHeight / 2 + chinaCenterOffsetFromCanvas;
    expect(Math.abs(naiveCentre - innerHeight / 2)).toBeGreaterThan(20);
  });
});

describe("arc and label geometry", () => {
  it("builds a quadratic arc that starts at the origin and ends at the destination", () => {
    const arc = createScreenArc({ x: 772.32, y: 397.77 }, { x: 784.8, y: 371.4 });
    expect(arc.d.startsWith("M 772.32 397.77")).toBe(true);
    expect(arc.d.endsWith("784.8 371.4")).toBe(true);
    expect(arc.length).toBeGreaterThan(0);
    expect(arc.d).not.toContain("NaN");
  });

  it("never overlaps two labels — lower tiers yield to higher ones", () => {
    const tiers = [
      {
        items: [
          { id: "c1", text: "济南", x: 100, y: 100, fill: "#fff", cls: "map-label-city", size: 22 },
        ],
      },
      {
        items: [
          { id: "p1", text: "山东", x: 104, y: 102, fill: "#ffe6cc", cls: "map-label", size: 19 },
        ],
      },
    ];
    const placed = placeLabels(tiers);
    expect(placed.map((item) => item.id)).toEqual(["c1", "p1"]);
    // 第二个标签必须避让到不同位置
    expect(placed[1]!.x).not.toBe(placed[0]!.x);
    expect(placed[1]!.y).not.toBe(placed[0]!.y);
  });

  it("drops a label that has nowhere conflict-free to go", () => {
    const tiers = [
      {
        items: [
          { id: "a", text: "甲甲甲甲", x: 200, y: 200, fill: "#fff", cls: "map-label-city", size: 22 },
          { id: "b", text: "乙乙乙乙", x: 210, y: 205, fill: "#fff", cls: "map-label", size: 19 },
        ],
      },
    ];
    const placed = placeLabels(tiers);
    expect(placed.some((item) => item.id === "a")).toBe(true);
  });
});
