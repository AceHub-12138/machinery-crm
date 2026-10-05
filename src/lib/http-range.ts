/**
 * HTTP Range 解析与 multipart/byteranges 响应组装（纯逻辑，便于单测）。
 *
 * 为什么需要多段 Range：electron-updater 的增量更新（generic 源）默认把本次要下的若干差异区间
 * 打包成一次多段请求（`Range: bytes=a-b, c-d, …`），并要求 206 + `multipart/byteranges`；
 * 只支持单段时它会判定「服务器不支持」而回退整包下载（100MB 级安装包每次都全量）。
 *
 * 语义按 RFC 7233：单个 `bytes=a-b` / `bytes=a-` / `bytes=-N`；多段用逗号分隔；
 * 全部段都越界返回 416；个别段越界只跳过该段。
 */

export interface ByteRange {
  /** 起始字节（含） */
  start: number;
  /** 结束字节（含） */
  end: number;
}

export interface ParsedRange {
  ranges: ByteRange[];
  /** 全部段都不可满足（应回 416） */
  unsatisfiable: boolean;
}

const RANGE_PREFIX = /^bytes\s*=/i;

function parsePart(part: string, size: number): ByteRange | null {
  const match = /^(\d*)-(\d*)$/.exec(part.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  if (rawStart === "") {
    // bytes=-N：末尾 N 字节
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return null;
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(end) || end < start) return null;
  return { start, end };
}

/** 解析 Range 头；不是 bytes 范围（none）时返回 null，交给调用方按整包处理 */
export function parseRangeHeader(header: string | null | undefined, size: number): ParsedRange | null {
  const raw = (header || "").trim();
  if (!raw || !RANGE_PREFIX.test(raw)) return null;
  if (size <= 0) return { ranges: [], unsatisfiable: true };

  const parts = raw.replace(RANGE_PREFIX, "").split(",");
  const ranges: ByteRange[] = [];
  for (const part of parts) {
    if (!part.trim()) continue;
    const parsed = parsePart(part, size);
    if (parsed) ranges.push(parsed);
  }
  return { ranges, unsatisfiable: ranges.length === 0 };
}

/** 单个分段的头（含前后 CRLF，与 RFC 7233 示例一致） */
export function multipartPartHeader(range: ByteRange, size: number, boundary: string): string {
  return `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes ${range.start}-${range.end}/${size}\r\n\r\n`;
}

export function multipartFooter(boundary: string): string {
  return `\r\n--${boundary}--\r\n`;
}

/** 精确的响应体长度：各分段头 + 数据 + 分隔符 + 收尾 */
export function multipartContentLength(ranges: ByteRange[], size: number, boundary: string): number {
  const headers = ranges.reduce((sum, range) => sum + Buffer.byteLength(multipartPartHeader(range, size, boundary), "utf8"), 0);
  const payload = ranges.reduce((sum, range) => sum + (range.end - range.start + 1), 0);
  return headers + payload + Buffer.byteLength(multipartFooter(boundary), "utf8");
}
