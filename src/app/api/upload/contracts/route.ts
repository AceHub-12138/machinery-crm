import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { getUploadPath, getUploadUrl, sanitizeFileName } from "@/lib/uploads";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File;

  if (!file) {
    return NextResponse.json({ error: "请选择文件" }, { status: 400 });
  }

  // 验证文件类型
  const allowedTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/jpeg",
    "image/png",
  ];
  const allowedExtensions = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"];
  const ext = path.extname(file.name).toLowerCase();

  if (!allowedExtensions.includes(ext)) {
    return NextResponse.json({ error: "不支持的文件格式，仅支持 PDF、Word、JPG、PNG" }, { status: 400 });
  }

  // 验证文件大小 (20MB)
  if (file.size > 100 * 1024 * 1024) {
    return NextResponse.json({ error: "文件大小不能超过 20MB" }, { status: 400 });
  }

  // 保存文件
  const uploadDir = getUploadPath("contracts");
  await mkdir(uploadDir, { recursive: true });

  const fileName = sanitizeFileName(file.name);
  const filePath = path.join(uploadDir, fileName);
  const bytes = await file.arrayBuffer();
  await writeFile(filePath, Buffer.from(bytes));

  const url = getUploadUrl("contracts", fileName);
  return NextResponse.json({ url, fileName });
}
