import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { formatDxfReport, parseDxf } from "@/lib/agent/cad/dxf-parser";
import type { XiaochuanAttachment } from "@/lib/agent/attachments";
import { getUploadPath } from "@/lib/uploads";

/**
 * CAD 附件分析（第 2 期段 4）：
 * - DXF：纯文本直接解析（自研解析器，零依赖）；
 * - DWG：闭源二进制，用免费的 ODA File Converter 转成 DXF 再解析（用户拍板方案）。
 *   转换器在服务器上单独安装（部署说明给步骤），未安装时优雅降级为提示话术，
 *   可用环境变量 ODA_CONVERTER_PATH 指定可执行文件路径。
 *   ODA 转换器是 Qt 图形程序，无显示器的服务器上经 xvfb-run 包装运行（自动探测）。
 */

const DWG_CONVERT_TIMEOUT_MS = 60_000;

async function fileExists(candidate: string): Promise<boolean> {
  try {
    await readFile(candidate);
    return true;
  } catch {
    return false;
  }
}

async function readAttachment(attachment: XiaochuanAttachment): Promise<Buffer | null> {
  const prefix = "/uploads/xiaochuan/";
  if (!attachment.url.startsWith(prefix)) return null;
  const storedName = attachment.url.slice(prefix.length);
  if (!storedName || storedName.includes("/") || storedName.includes("\\") || storedName.includes("..")) return null;
  try {
    return await readFile(getUploadPath("xiaochuan", storedName));
  } catch {
    return null;
  }
}

/** 解析出完整转换命令（含 xvfb-run 前缀）；未安装返回 null */
async function resolveConverterCommand(): Promise<string[] | null> {
  const candidates = [
    process.env.ODA_CONVERTER_PATH,
    "/usr/bin/ODAFileConverter",
    "/opt/ODAFileConverter/ODAFileConverter",
  ].filter(Boolean) as string[];
  let converter: string | null = null;
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      converter = candidate;
      break;
    }
  }
  if (!converter) return null;
  // 无头服务器：优先用 xvfb-run 包装（ODA 是 Qt GUI，缺 DISPLAY 会直接退出）
  for (const xvfbRun of ["/usr/bin/xvfb-run", "/usr/local/bin/xvfb-run"]) {
    if (await fileExists(xvfbRun)) return [xvfbRun, "-a", converter];
  }
  return [converter];
}

async function runCommand(command: string[], args: string[], timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command[0], [...command.slice(1), ...args], { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

/** DWG → DXF：把文件放进独立临时目录，调 ODAFileConverter 批量转换，读回 .dxf */
async function convertDwgToDxf(dwg: Buffer, storedName: string): Promise<Buffer | null> {
  const command = await resolveConverterCommand();
  if (!command) return null;
  const workDir = await mkdtemp(path.join(tmpdir(), "xiaochuan-dwg-"));
  try {
    const inputDir = path.join(workDir, "in");
    const outputDir = path.join(workDir, "out");
    await writeFile(path.join(inputDir, storedName), dwg);
    // ODA 命令行：<inputDir> <outputDir> <version> <type> <recurse> <audit>
    const ok = await runCommand(command, [inputDir, outputDir, "ACAD2018", "DXF", "0", "1"], DWG_CONVERT_TIMEOUT_MS);
    if (!ok) return null;
    const outputs = (await readdir(outputDir)).filter((name) => name.toLowerCase().endsWith(".dxf"));
    if (!outputs.length) return null;
    return await readFile(path.join(outputDir, outputs[0]));
  } catch {
    return null;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function encodingFromBuffer(buffer: Buffer): BufferEncoding {
  // DXF 绝大多数是 ASCII/UTF-8；本地 Windows 导出的可能是 GBK，先按 UTF-8 容错
  return buffer.includes(0) ? "latin1" : "utf-8";
}

/** CAD 附件 → 给模型的分析注记；任何失败都返回可读的降级话术（不抛错） */
export async function analyzeCadAttachment(attachment: XiaochuanAttachment): Promise<string> {
  const storedName = attachment.url.split("/").pop() ?? attachment.name;
  const isDxf = storedName.toLowerCase().endsWith(".dxf");
  const isDwg = storedName.toLowerCase().endsWith(".dwg");
  if (!isDxf && !isDwg) {
    return `《${attachment.name}》[CAD 图纸]：暂不支持该 CAD 格式，请让用户改传 DXF/DWG 或用文字描述关键尺寸。`;
  }

  const raw = await readAttachment(attachment);
  if (!raw) return `《${attachment.name}》[CAD 图纸]：文件读取失败，请用户重新上传。`;

  let dxfBuffer: Buffer | null = raw;
  if (isDwg) {
    dxfBuffer = await convertDwgToDxf(raw, storedName);
    if (!dxfBuffer) {
      return [
        `《${attachment.name}》[CAD 图纸]：DWG 是加密的商用格式，需要服务器安装免费的 ODA File Converter 才能自动转换解析。`,
        "当前服务器尚未安装（或环境变量 ODA_CONVERTER_PATH 未指向它）。请让用户改传 DXF 文件，或对图纸截图后以图片方式上传。",
      ].join("");
    }
  }

  try {
    const content = dxfBuffer.toString(encodingFromBuffer(dxfBuffer));
    const stats = parseDxf(content);
    if (!stats.lines && !stats.circles && !stats.arcs && !stats.polylines && !stats.textCount) {
      return `《${attachment.name}》[CAD 图纸]：文件里没有解析到可识别的图形实体，可能是空文件或非图纸数据，请用户确认导出是否正确。`;
    }
    return formatDxfReport(attachment.name, stats);
  } catch {
    return `《${attachment.name}》[CAD 图纸]：文件内容解析失败，可能已损坏，请用户重新导出后再传。`;
  }
}
