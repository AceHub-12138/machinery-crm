import { describe, expect, it } from "vitest";
import { formatDxfReport, parseDxf } from "@/lib/agent/cad/dxf-parser";

/** 模拟法兰板图纸：矩形轮廓 + 中心大圆 + 4 个均布螺栓孔 + 键槽圆弧 + 文字标注 */
const SAMPLE_DXF = [
  "0", "SECTION", "2", "HEADER",
  "9", "$INSUNITS", "70", "4",
  "0", "ENDSEC",
  "0", "SECTION", "2", "ENTITIES",
  // 矩形轮廓
  "0", "LINE", "10", "0", "20", "0", "11", "240", "21", "0",
  "0", "LINE", "10", "240", "20", "0", "11", "240", "21", "160",
  "0", "LINE", "10", "240", "20", "160", "11", "0", "21", "160",
  "0", "LINE", "10", "0", "20", "160", "11", "0", "21", "0",
  // 中心大圆（外圆 φ80）
  "0", "CIRCLE", "10", "120", "20", "80", "40", "40",
  // 4 个螺栓孔 φ12
  "0", "CIRCLE", "10", "40", "20", "40", "40", "6",
  "0", "CIRCLE", "10", "200", "20", "40", "40", "6",
  "0", "CIRCLE", "10", "40", "20", "120", "40", "6",
  "0", "CIRCLE", "10", "200", "20", "120", "40", "6",
  // 键槽圆弧（R6 → φ12，与螺栓孔同径聚合）
  "0", "ARC", "10", "20", "20", "20", "40", "6", "50", "0", "51", "180",
  // 文字与标注
  "0", "TEXT", "10", "10", "20", "150", "40", "5", "1", "HT250",
  "0", "MTEXT", "10", "10", "20", "10", "40", "5", "1", "KEYWAY 12x5 L50",
  "0", "DIMENSION", "10", "0", "20", "-20", "1", "<>", "42", "240",
  "0", "ENDSEC",
  "0", "EOF",
].join("\n");

describe("parseDxf", () => {
  it("统计实体数量与包围盒", () => {
    const stats = parseDxf(SAMPLE_DXF);
    expect(stats.lines).toBe(4);
    expect(stats.circles).toBe(5);
    expect(stats.arcs).toBe(1);
    expect(stats.textCount).toBe(2);
    expect(stats.dimensions).toBe(1);
    expect(stats.insunits).toBe(4);
    expect(stats.bbox).toEqual({ minX: 0, minY: -20, maxX: 240, maxY: 160 });
  });

  it("直径聚合降序：φ80×1、φ12×5", () => {
    const stats = parseDxf(SAMPLE_DXF);
    expect(stats.diameters[0]).toEqual({ diameter: 80, count: 1 });
    expect(stats.diameters[1]).toEqual({ diameter: 12, count: 5 });
  });

  it("文字与标注内容收集（含 DIMENSION 实测值）", () => {
    const stats = parseDxf(SAMPLE_DXF);
    expect(stats.texts).toContain("HT250");
    expect(stats.texts).toContain("KEYWAY 12x5 L50");
    expect(stats.texts).toContain("240");
  });

  it("空/损坏内容不抛错，实体为零", () => {
    const stats = parseDxf("not a dxf at all");
    expect(stats.lines).toBe(0);
    expect(stats.circles).toBe(0);
    expect(stats.bbox).toBeNull();
  });
});

describe("formatDxfReport", () => {
  it("报告包含单位、图幅、统计、孔径与标注文字", () => {
    const report = formatDxfReport("法兰板.dxf", parseDxf(SAMPLE_DXF));
    expect(report).toContain("法兰板.dxf");
    expect(report).toContain("mm（图面已标注单位）");
    expect(report).toContain("φ80×1");
    expect(report).toContain("φ12×5");
    expect(report).toContain("HT250");
    expect(report).toContain("KEYWAY 12x5 L50");
    expect(report).toContain("向用户确认关键尺寸");
  });

  it("未标注单位时按机械惯例提示毫米", () => {
    const report = formatDxfReport("a.dxf", parseDxf("0\nEOF"));
    expect(report).toContain("按毫米理解");
  });
});
