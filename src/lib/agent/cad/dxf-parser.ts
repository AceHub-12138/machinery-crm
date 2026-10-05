/**
 * 轻量 DXF 解析器（第 2 期段 4）：自研零依赖，只提取选型需要的几何统计与文字标注。
 *
 * DXF 是 group code/value 成对的文本格式；实体在 ENTITIES 段内以 code 0 分组。
 * 这里不做完整 CAD 语义还原，只统计：直线/圆/圆弧/多段线数量、包围盒、
 * 圆与弧的直径集合（孔径与外径特征）、TEXT/MTEXT/DIMENSION 的文字内容（尺寸标注）。
 */

export type DxfStats = {
  lines: number;
  circles: number;
  arcs: number;
  polylines: number;
  textCount: number;
  dimensions: number;
  inserts: number;
  others: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** 圆与圆弧的直径（同一直径聚合计数，降序） */
  diameters: Array<{ diameter: number; count: number }>;
  /** 图中文字与标注内容（去重保序，最多 40 条） */
  texts: string[];
  /** HEADER 段 $INSUNITS（4=mm，1=inch，null=未标注） */
  insunits: number | null;
};

type Point = { x: number; y: number };

function toNumber(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseDxf(content: string): DxfStats {
  const lines = content.split(/\r?\n/);
  const stats: DxfStats = {
    lines: 0, circles: 0, arcs: 0, polylines: 0, textCount: 0, dimensions: 0, inserts: 0, others: 0,
    bbox: null, diameters: [], texts: [], insunits: null,
  };

  let section = "";
  let entity: { type: string; codes: Array<[number, string]> } | null = null;
  let inHeaderInsunits = false;
  const textSeen = new Set<string>();
  const diameterRaw: number[] = [];
  const points: Point[] = [];
  const radii: Array<{ center: Point; r: number }> = [];

  const pushPoint = (point: Point) => points.push(point);
  const growBboxByRadius = (center: Point, r: number) => {
    pushPoint({ x: center.x - r, y: center.y - r });
    pushPoint({ x: center.x + r, y: center.y + r });
  };

  let pendingText = "";
  let dimensionValue: number | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const codeLine = lines[i].trim();
    if (!codeLine) continue;
    const code = Number(codeLine);
    const value = (lines[i + 1] ?? "").trimEnd();
    i += 1;
    if (!Number.isInteger(code)) continue;

    if (code === 0 && value === "SECTION") {
      // 下一个 group 是 2 + 段名
      while (i + 1 < lines.length && Number(lines[i].trim()) !== 2) i += 1;
      section = (lines[i + 1] ?? "").trim();
      i += 1;
      continue;
    }
    if (code === 0 && value === "ENDSEC") {
      // 段结束前先落账最后一个实体（否则紧贴 ENDSEC 的实体数据被丢弃）
      if (entity) finishEntity(entity);
      entity = null;
      section = "";
      continue;
    }

    if (section === "HEADER") {
      if (code === 9 && value === "$INSUNITS") inHeaderInsunits = true;
      else if (inHeaderInsunits && code === 70) {
        stats.insunits = toNumber(value);
        inHeaderInsunits = false;
      } else if (code === 9) inHeaderInsunits = false;
      continue;
    }

    if (section !== "ENTITIES") continue;

    if (code === 0) {
      // 结束上一个实体
      if (entity) finishEntity(entity);
      entity = { type: value, codes: [] };
      pendingText = "";
      dimensionValue = null;
      continue;
    }
    entity?.codes.push([code, value]);
  }
  if (entity) finishEntity(entity);

  function finishEntity(current: { type: string; codes: Array<[number, string]> }) {
    const get = (wanted: number): number | null => {
      for (const [code, value] of current.codes) if (code === wanted) return toNumber(value);
      return null;
    };
    const x = get(10);
    const y = get(20);
    const x2 = get(11);
    const y2 = get(21);
    const r = get(40);

    switch (current.type) {
      case "LINE": {
        stats.lines += 1;
        if (x !== null && y !== null) pushPoint({ x, y });
        if (x2 !== null && y2 !== null) pushPoint({ x: x2, y: y2 });
        break;
      }
      case "CIRCLE": {
        stats.circles += 1;
        if (x !== null && y !== null && r !== null) {
          radii.push({ center: { x, y }, r });
          growBboxByRadius({ x, y }, r);
          diameterRaw.push(Math.round(r * 2 * 10) / 10);
        }
        break;
      }
      case "ARC": {
        stats.arcs += 1;
        if (x !== null && y !== null && r !== null) {
          radii.push({ center: { x, y }, r });
          growBboxByRadius({ x, y }, r);
          diameterRaw.push(Math.round(r * 2 * 10) / 10);
        }
        break;
      }
      case "LWPOLYLINE":
      case "POLYLINE": {
        stats.polylines += 1;
        for (let k = 0; k < current.codes.length; k += 1) {
          const [code, value] = current.codes[k];
          if (code === 10) {
            const py = toNumber(current.codes[k + 1]?.[1] ?? "");
            const px = toNumber(value);
            if (px !== null && py !== null) pushPoint({ x: px, y: py });
          }
        }
        break;
      }
      case "TEXT":
      case "MTEXT": {
        stats.textCount += 1;
        const parts: string[] = [];
        for (const [code, value] of current.codes) {
          if (code === 3 || code === 1) parts.push(value);
        }
        const text = parts.join("").replace(/\\[Pp]|%%[dDpPcC]/g, " ").trim();
        if (text && !textSeen.has(text) && textSeen.size < 40) {
          textSeen.add(text);
          stats.texts.push(text.slice(0, 60));
        }
        break;
      }
      case "DIMENSION": {
        stats.dimensions += 1;
        // 标注的定义点也计入图幅（图幅语义=含尺寸标注的范围）
        if (x !== null && y !== null) pushPoint({ x, y });
        if (x2 !== null && y2 !== null) pushPoint({ x: x2, y: y2 });
        const label = current.codes.find(([code]) => code === 1)?.[1] ?? "";
        // code 1 为 "<>" 表示标注文字用实测值（值在 code 42）
        const measured = get(42);
        const shown = label && label !== "<>" ? label : measured !== null ? String(measured) : "";
        const text = shown.trim();
        if (text && !textSeen.has(text) && textSeen.size < 40) {
          textSeen.add(text);
          stats.texts.push(text.slice(0, 60));
        }
        break;
      }
      case "INSERT": {
        stats.inserts += 1;
        if (x !== null && y !== null) pushPoint({ x, y });
        break;
      }
      default:
        stats.others += 1;
    }
  }

  const bbox = points.length
    ? {
        minX: Math.min(...points.map((p) => p.x)),
        minY: Math.min(...points.map((p) => p.y)),
        maxX: Math.max(...points.map((p) => p.x)),
        maxY: Math.max(...points.map((p) => p.y)),
      }
    : null;
  stats.bbox = bbox;

  const grouped = new Map<number, number>();
  for (const d of diameterRaw) grouped.set(d, (grouped.get(d) ?? 0) + 1);
  stats.diameters = [...grouped.entries()]
    .map(([diameter, count]) => ({ diameter, count }))
    .sort((a, b) => b.diameter - a.diameter)
    .slice(0, 15);

  return stats;
}

/** 解析报告 → 给模型的文字（DXF/DWG 通用） */
export function formatDxfReport(fileName: string, stats: DxfStats): string {
  const units = stats.insunits === 4 ? "mm（图面已标注单位）"
    : stats.insunits === 1 ? "inch（图面已标注单位）"
    : "图中未标注单位，机械图惯例按毫米理解";
  const size = stats.bbox
    ? `${round(stats.bbox.maxX - stats.bbox.minX)} × ${round(stats.bbox.maxY - stats.bbox.minY)}`
    : "未知";
  const counts = [
    stats.lines ? `直线 ${stats.lines}` : "",
    stats.circles ? `圆 ${stats.circles}` : "",
    stats.arcs ? `圆弧 ${stats.arcs}` : "",
    stats.polylines ? `多段线 ${stats.polylines}` : "",
    stats.texts ? `文字 ${stats.texts}` : "",
    stats.dimensions ? `尺寸标注 ${stats.dimensions}` : "",
    stats.inserts ? `图块引用 ${stats.inserts}` : "",
  ].filter(Boolean).join("、") || "无标准实体";
  const diameters = stats.diameters.length
    ? stats.diameters.map((item) => `φ${round(item.diameter)}×${item.count}`).join("、")
    : "未见整圆特征";
  const texts = stats.texts.length ? stats.texts.join("；") : "图中无文字标注";

  return [
    `【CAD 图纸解析结果】《${fileName}》（DXF 几何数据，非图片）`,
    `- 单位：${units}`,
    `- 图幅范围：约 ${size}（含图框与标注，实际工件轮廓以尺寸标注为准）`,
    `- 图形统计：${counts}`,
    `- 圆/孔特征（直径×数量，降序，最多 15 组）：${diameters}`,
    `- 图中文字与标注内容：${texts}`,
    "以上是从 CAD 文件里真实解析出的几何与标注数据；零件的具体语义（哪个是外形、哪个是孔）请结合经验推断，并向用户确认关键尺寸。",
  ].join("\n");
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
