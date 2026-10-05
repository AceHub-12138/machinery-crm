// 集成测试：公开下载路由的 Range 行为（客户端增量更新的服务端契约）。
// 关键回归：多段 Range 必须返回 206 + multipart/byteranges，单段必须 206 + Content-Range，
// 否则桌面端 electron-updater 会判定服务器不支持增量，回退整包下载。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DOWNLOAD_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "dc-downloads-"));
const FILE_NAME = "DachuanPro-Setup-1.1.1.exe";
const FILE_BYTES = Buffer.alloc(4096);
for (let i = 0; i < FILE_BYTES.length; i += 1) FILE_BYTES[i] = i % 251;

process.env.DOWNLOAD_DIR = DOWNLOAD_ROOT;
fs.mkdirSync(path.join(DOWNLOAD_ROOT, "desktop"), { recursive: true });
fs.writeFileSync(path.join(DOWNLOAD_ROOT, "desktop", FILE_NAME), FILE_BYTES);

// 在设置好 DOWNLOAD_DIR 之后再导入路由（模块内读环境变量）
const { GET } = await import("./route");

function get(range?: string) {
  const request = new NextRequest(`https://example.test/api/downloads/desktop/${FILE_NAME}`, {
    headers: range ? { range } : undefined,
  });
  return GET(request, { params: Promise.resolve({ path: ["desktop", FILE_NAME] }) });
}

beforeAll(() => {
  expect(fs.existsSync(path.join(DOWNLOAD_ROOT, "desktop", FILE_NAME))).toBe(true);
});

afterAll(() => {
  fs.rmSync(DOWNLOAD_ROOT, { recursive: true, force: true });
});

describe("GET /api/downloads/[...path]", () => {
  it("无 Range：整包 200 + Content-Length", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(FILE_BYTES.length));
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(FILE_BYTES)).toBe(true);
  });

  it("单段 Range：206 + Content-Range（客户端关闭多段请求后走这条路）", async () => {
    const res = await get("bytes=10-19");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 10-19/${FILE_BYTES.length}`);
    expect(res.headers.get("content-length")).toBe("10");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(FILE_BYTES.subarray(10, 20))).toBe(true);
  });

  it("多段 Range：206 + multipart/byteranges（electron-updater 默认形态）", async () => {
    const res = await get("bytes=0-9,100-109,4000-4009");
    expect(res.status).toBe(206);
    const contentType = res.headers.get("content-type") || "";
    expect(contentType).toMatch(/^multipart\/byteranges;\s*boundary=/);
    const boundary = contentType.split("boundary=")[1];

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBe(Number(res.headers.get("content-length")));

    const text = body.toString("latin1");
    expect(text.startsWith(`\r\n--${boundary}\r\n`)).toBe(true);
    expect(text.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true);
    for (const [start, end] of [[0, 9], [100, 109], [4000, 4009]] as const) {
      expect(text).toContain(`Content-Range: bytes ${start}-${end}/${FILE_BYTES.length}`);
    }

    // 逐段核对数据：按分割符切出每段实体，必须与源文件对应区间逐字节相同
    const segments = text.split(`\r\n--${boundary}`);
    const payloads: Buffer[] = [];
    for (const segment of segments) {
      const splitIndex = segment.indexOf("\r\n\r\n");
      if (splitIndex < 0) continue;
      payloads.push(Buffer.from(segment.slice(splitIndex + 4), "latin1"));
    }
    expect(payloads.length).toBe(3);
    expect(payloads[0].equals(FILE_BYTES.subarray(0, 10))).toBe(true);
    expect(payloads[1].equals(FILE_BYTES.subarray(100, 110))).toBe(true);
    expect(payloads[2].equals(FILE_BYTES.subarray(4000, 4010))).toBe(true);
  });

  it("全部段越界：416 + Content-Range: bytes */size", async () => {
    const res = await get(`bytes=${FILE_BYTES.length + 10}-${FILE_BYTES.length + 20}`);
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${FILE_BYTES.length}`);
  });

  it("非白名单扩展名：403", async () => {
    const request = new NextRequest("https://example.test/api/downloads/desktop/latest.txt");
    const res = await GET(request, { params: Promise.resolve({ path: ["desktop", "latest.txt"] }) });
    expect(res.status).toBe(403);
  });

  it("路径穿越：400", async () => {
    const request = new NextRequest("https://example.test/api/downloads/..%2F.env");
    const res = await GET(request, { params: Promise.resolve({ path: ["..", ".env"] }) });
    expect([400, 403]).toContain(res.status);
  });
});
