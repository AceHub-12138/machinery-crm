// 单测：下载路由的 Range 解析与 multipart/byteranges 组装。
// 关键回归：多段 Range 必须能按 multipart 返回，否则 electron-updater 判定服务器不支持 → 回退整包下载。
import { describe, expect, it } from "vitest";

import {
  multipartContentLength,
  multipartFooter,
  multipartPartHeader,
  parseRangeHeader,
} from "@/lib/http-range";

const SIZE = 104426979;

describe("parseRangeHeader", () => {
  it("非 bytes 范围或空头返回 null（按整包处理）", () => {
    expect(parseRangeHeader(null, SIZE)).toBeNull();
    expect(parseRangeHeader("", SIZE)).toBeNull();
    expect(parseRangeHeader("items=0-1", SIZE)).toBeNull();
  });

  it("单段：bytes=a-b / bytes=a- / bytes=-N", () => {
    expect(parseRangeHeader("bytes=0-1023", SIZE)).toEqual({ ranges: [{ start: 0, end: 1023 }], unsatisfiable: false });
    expect(parseRangeHeader("bytes=100-", SIZE)).toEqual({ ranges: [{ start: 100, end: SIZE - 1 }], unsatisfiable: false });
    expect(parseRangeHeader("bytes=-500", SIZE)).toEqual({ ranges: [{ start: SIZE - 500, end: SIZE - 1 }], unsatisfiable: false });
    // 结束位置越界按文件末尾截断
    expect(parseRangeHeader(`bytes=100-${SIZE + 9999}`, SIZE)).toEqual({ ranges: [{ start: 100, end: SIZE - 1 }], unsatisfiable: false });
  });

  it("多段：逗号分隔的多段全部解析（electron-updater 增量更新的默认形态）", () => {
    expect(parseRangeHeader("bytes=0-1023,2000000-2001023,1618807-1620000", SIZE)).toEqual({
      ranges: [
        { start: 0, end: 1023 },
        { start: 2000000, end: 2001023 },
        { start: 1618807, end: 1620000 },
      ],
      unsatisfiable: false,
    });
  });

  it("多段允许空格、尾部多余逗号与空段", () => {
    expect(parseRangeHeader("bytes=0-10, 20-30 , ", SIZE)).toEqual({
      ranges: [{ start: 0, end: 10 }, { start: 20, end: 30 }],
      unsatisfiable: false,
    });
  });

  it("全部段越界 → unsatisfiable（上层回 416）", () => {
    expect(parseRangeHeader(`bytes=${SIZE}-${SIZE + 10}`, SIZE)).toEqual({ ranges: [], unsatisfiable: true });
    expect(parseRangeHeader("bytes=abc-def", SIZE)).toEqual({ ranges: [], unsatisfiable: true });
  });

  it("个别段越界只跳过该段，其余照常返回", () => {
    expect(parseRangeHeader(`bytes=${SIZE + 5}-${SIZE + 9},0-9`, SIZE)).toEqual({
      ranges: [{ start: 0, end: 9 }],
      unsatisfiable: false,
    });
  });

  it("非法区间（结束小于起始）被丢弃", () => {
    expect(parseRangeHeader("bytes=100-50", SIZE)).toEqual({ ranges: [], unsatisfiable: true });
  });
});

describe("multipart 响应组装", () => {
  const boundary = "dcrangetestboundary";

  it("分段头带 Content-Range 与 Content-Type", () => {
    const header = multipartPartHeader({ start: 10, end: 19 }, SIZE, boundary);
    expect(header).toContain(`--${boundary}\r\n`);
    expect(header).toContain("Content-Type: application/octet-stream\r\n");
    expect(header).toContain(`Content-Range: bytes 10-19/${SIZE}\r\n\r\n`);
  });

  it("收尾分隔符形如 --boundary--", () => {
    expect(multipartFooter(boundary)).toBe(`\r\n--${boundary}--\r\n`);
  });

  it("Content-Length 等于各分段头 + 数据 + 尾部的总字节数", () => {
    const ranges = [{ start: 0, end: 1023 }, { start: 2000000, end: 2001023 }];
    const expected =
      Buffer.byteLength(multipartPartHeader(ranges[0], SIZE, boundary)) +
      1024 +
      Buffer.byteLength(multipartPartHeader(ranges[1], SIZE, boundary)) +
      1024 +
      Buffer.byteLength(multipartFooter(boundary));
    expect(multipartContentLength(ranges, SIZE, boundary)).toBe(expected);
  });
});
