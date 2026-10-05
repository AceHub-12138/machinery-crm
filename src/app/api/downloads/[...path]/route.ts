import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { getDownloadRoot, isAllowedDownloadFile } from "@/lib/downloads";
import { multipartContentLength, multipartFooter, multipartPartHeader, parseRangeHeader, type ByteRange } from "@/lib/http-range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isInsideBaseDir(baseDir: string, filePath: string) {
  const relativePath = path.relative(baseDir, filePath);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

/** 多段 Range 的响应体：逐段写「分段头 + 文件切片」，最后补收尾分隔符（全程 Buffer，Web Stream 不接受字符串块） */
async function* multipartBody(filePath: string, ranges: ByteRange[], size: number, boundary: string): AsyncGenerator<Buffer> {
  for (const range of ranges) {
    yield Buffer.from(multipartPartHeader(range, size, boundary), "utf8");
    for await (const chunk of fs.createReadStream(filePath, { start: range.start, end: range.end })) {
      yield chunk as Buffer;
    }
  }
  yield Buffer.from(multipartFooter(boundary), "utf8");
}

/**
 * 公开下载路由（免登录）：桌面客户端安装包 / 增量更新块图 / latest.yml。
 * 仅允许 DOWNLOAD_ROOT 白名单目录下的白名单扩展名，路径穿越校验与 /api/uploads 同款。
 *
 * Range 支持分两档，缺一不可：
 * - 单段 `bytes=a-b`（206）：客户端 useMultipleRangeRequest=false 时增量更新走这条路；
 * - 多段 `bytes=a-b, c-d, …`（206 + multipart/byteranges）：electron-updater 对 generic 源默认发多段请求，
 *   服务器若不按 multipart 返回，它会判定「不支持 Range」而回退整包下载（实测 1.1.0→1.1.1 本该只下 1.6%）。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await params;
  if (!pathSegments?.length || pathSegments.some((segment) => segment.includes("\0"))) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const baseDir = path.resolve(getDownloadRoot());
  const filePath = path.resolve(baseDir, pathSegments.join(path.sep));
  if (!isInsideBaseDir(baseDir, filePath)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const fileName = path.basename(filePath);
  if (!isAllowedDownloadFile(fileName)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const realBaseDir = fs.realpathSync(baseDir);
    const realFilePath = fs.realpathSync(filePath);
    if (!isInsideBaseDir(realBaseDir, realFilePath) || !fs.statSync(realFilePath).isFile()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const stat = fs.statSync(realFilePath);

    const isManifest = fileName.toLowerCase().endsWith(".yml");
    const headers = new Headers({
      "Content-Type": isManifest ? "application/yaml" : "application/octet-stream",
      // 清单必须实时（更新器每次都要拿到最新版本号）；安装包按版本命名可短缓存
      "Cache-Control": isManifest ? "public, no-cache" : "public, max-age=3600",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      // 百 MB 级安装包直传，不让 Nginx 缓冲到临时文件
      "X-Accel-Buffering": "no",
    });
    if (!isManifest) {
      headers.set("Content-Disposition", `attachment; filename="${fileName}"`);
    }

    const parsed = parseRangeHeader(request.headers.get("range"), stat.size);
    if (parsed) {
      if (parsed.unsatisfiable) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${stat.size}` },
        });
      }

      if (parsed.ranges.length === 1) {
        const { start, end } = parsed.ranges[0];
        headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
        headers.set("Content-Length", String(end - start + 1));
        const partial = Readable.toWeb(
          fs.createReadStream(realFilePath, { start, end }),
        ) as unknown as ReadableStream;
        return new NextResponse(partial, { status: 206, headers });
      }

      const boundary = `dcrange${crypto.randomUUID().replace(/-/g, "")}`;
      headers.set("Content-Type", `multipart/byteranges; boundary=${boundary}`);
      headers.set("Content-Length", String(multipartContentLength(parsed.ranges, stat.size, boundary)));
      const stream = Readable.toWeb(
        Readable.from(multipartBody(realFilePath, parsed.ranges, stat.size, boundary)),
      ) as unknown as ReadableStream;
      return new NextResponse(stream, { status: 206, headers });
    }

    headers.set("Content-Length", String(stat.size));
    const body = Readable.toWeb(fs.createReadStream(realFilePath)) as unknown as ReadableStream;
    return new NextResponse(body, { status: 200, headers });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
