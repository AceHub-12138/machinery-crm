import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getXiaochuanViewer } from "@/lib/agent/auth";
import {
  MAX_ATTACHMENT_BYTES,
  attachmentKindFromName,
  attachmentMagicMatches,
  isAllowedAttachmentExtension,
  mimeMatchesKind,
  sanitizeAttachmentName,
} from "@/lib/agent/attachments";
import { getUploadPath, getUploadUrl } from "@/lib/uploads";
import { xiaochuanUploadScope } from "@/lib/agent/upload-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 小川附件上传（第 2 期段 2）：与头像/合同附件同一套安全模式——
 * 登录鉴权、扩展名白名单 + MIME 粗校验、大小上限、uuid 落盘文件名、受保护代理读取。
 * 文件存 uploads/xiaochuan/ 下；任何登录用户可上传（对话全员可用），查看走 /api/uploads 鉴权代理。
 */
export async function POST(request: Request) {
  // 双身份：CRM 员工或 Agent 独立账号均可上传对话附件（白名单/魔数/大小校验不变）
  const viewer = await getXiaochuanViewer();
  if (!viewer) return Response.json({ error: "请先登录" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "上传内容格式无效" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return Response.json({ error: "请选择要上传的文件" }, { status: 400 });
  if (file.size <= 0) return Response.json({ error: "文件是空的" }, { status: 400 });
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return Response.json({ error: "文件超过 20MB 上限" }, { status: 413 });
  }

  const displayName = sanitizeAttachmentName(file.name || "附件");
  if (!isAllowedAttachmentExtension(displayName)) {
    return Response.json({ error: "暂只支持图片（jpg/png/webp/gif/bmp）、PDF、DXF、DWG" }, { status: 415 });
  }
  const kind = attachmentKindFromName(displayName);
  if (!kind) return Response.json({ error: "暂不支持该文件类型" }, { status: 415 });
  if (!mimeMatchesKind(kind, file.type)) {
    return Response.json({ error: "文件内容与扩展名不一致" }, { status: 415 });
  }

  const ext = path.extname(displayName).toLowerCase();
  const storedName = `${Date.now()}-${randomUUID()}${ext}`;
  const ownerScope = xiaochuanUploadScope(viewer);
  const targetPath = getUploadPath(...ownerScope, storedName);

  try {
    await mkdir(path.dirname(targetPath), { recursive: true });
    const bytes = Buffer.from(await file.arrayBuffer());
    // 文件头（魔数）校验：防改扩展名伪装；图片/PDF 格式头固定，DXF/DWG 段 4 解析时再深校验
    if (!attachmentMagicMatches(displayName, bytes)) {
      return Response.json({ error: "文件内容与扩展名不一致" }, { status: 415 });
    }
    await writeFile(targetPath, bytes, { flag: "wx" });
  } catch {
    return Response.json({ error: "文件保存失败，请稍后再试" }, { status: 500 });
  }

  return Response.json({
    url: getUploadUrl(...ownerScope, storedName),
    name: displayName,
    type: file.type || "application/octet-stream",
    size: file.size,
    kind,
  });
}
