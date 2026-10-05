import { randomUUID } from "node:crypto";
import { readBoundedBody } from "@/lib/bounded-request";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { getUploadPath, getUploadUrl, sanitizeFileName } from "@/lib/uploads";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!["SUPER_ADMIN", "SALES", "FOREIGN_TRADE"].includes(user.role)) {
    return NextResponse.json({ error: "无权限上传合同附件" }, { status: 403 });
  }

  let formData: FormData;
  try {
    const bytes = await readBoundedBody(request, 20 * 1024 * 1024 + 128 * 1024);
    formData = await new Response(bytes, { headers: { "content-type": request.headers.get("content-type") || "" } }).formData();
  } catch {
    return NextResponse.json({ error: "上传内容无效或超过 20MB 限制" }, { status: 400 });
  }
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "请选择文件" }, { status: 400 });
  }

  // 验证文件类型
  const allowedExtensions = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"];
  const ext = path.extname(file.name).toLowerCase();

  if (!allowedExtensions.includes(ext)) {
    return NextResponse.json({ error: "不支持的文件格式，仅支持 PDF、Word、JPG、PNG" }, { status: 400 });
  }

  // 验证文件大小 (20MB)
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "文件大小不能超过 20MB" }, { status: 400 });
  }

  // 保存文件
  const scope = ["contracts", "crm", user.id];
  const uploadDir = getUploadPath(...scope);
  await mkdir(uploadDir, { recursive: true });

  const fileName = `${randomUUID()}_${sanitizeFileName(file.name)}`;
  const filePath = path.join(uploadDir, fileName);
  const bytes = await file.arrayBuffer();
  await writeFile(filePath, Buffer.from(bytes));

  const url = getUploadUrl(...scope, fileName);
  return NextResponse.json({ url, fileName });
}
