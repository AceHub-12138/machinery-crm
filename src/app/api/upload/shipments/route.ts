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
  const type = String(formData.get("type") || "docs");

  if (!file) {
    return NextResponse.json({ error: "请选择文件" }, { status: 400 });
  }

  const ext = path.extname(file.name).toLowerCase();
  const allowedExtensions =
    type === "photos"
      ? [".jpg", ".jpeg", ".png", ".webp"]
      : [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png", ".webp"];

  if (!allowedExtensions.includes(ext)) {
    return NextResponse.json(
      { error: type === "photos" ? "发货照片仅支持 JPG、PNG、WEBP" : "发货单仅支持 PDF、Word、JPG、PNG、WEBP" },
      { status: 400 }
    );
  }

  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "文件大小不能超过 20MB" }, { status: 400 });
  }

  const folder = type === "photos" ? "photos" : "docs";
  const uploadDir = getUploadPath("shipments", folder);
  await mkdir(uploadDir, { recursive: true });

  const fileName = sanitizeFileName(file.name);
  const filePath = path.join(uploadDir, fileName);
  const bytes = await file.arrayBuffer();
  await writeFile(filePath, Buffer.from(bytes));

  return NextResponse.json({
    url: getUploadUrl("shipments", folder, fileName),
    fileName,
  });
}
