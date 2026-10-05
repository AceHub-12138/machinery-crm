import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, canManageProducts } from "@/lib/permissions";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { getUploadPath, getUploadUrl, sanitizeFileName } from "@/lib/uploads";

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp"];
const VIDEO_EXTS = [".mp4", ".mov", ".avi", ".webm"];
const DOC_EXTS = [".pdf", ".doc", ".docx"];

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageProducts(user)) {
    return NextResponse.json({ error: "No permission to upload product files" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File;

  if (!file) {
    return NextResponse.json({ error: "Please choose a file" }, { status: 400 });
  }

  const ext = path.extname(file.name).toLowerCase();
  const allAllowed = [...IMAGE_EXTS, ...VIDEO_EXTS, ...DOC_EXTS];

  if (!allAllowed.includes(ext)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  const maxSize = VIDEO_EXTS.includes(ext) ? 100 * 1024 * 1024 : 100 * 1024 * 1024;
  if (file.size > maxSize) {
    return NextResponse.json({ error: "File is too large" }, { status: 400 });
  }

  let subDir = "docs";
  let fileType = "doc";
  if (IMAGE_EXTS.includes(ext)) {
    subDir = "images";
    fileType = "image";
  } else if (VIDEO_EXTS.includes(ext)) {
    subDir = "videos";
    fileType = "video";
  }

  const uploadDir = getUploadPath("products", subDir);
  await mkdir(uploadDir, { recursive: true });

  const fileName = sanitizeFileName(file.name);
  const filePath = path.join(uploadDir, fileName);
  const bytes = await file.arrayBuffer();
  await writeFile(filePath, Buffer.from(bytes));

  const url = getUploadUrl("products", subDir, fileName);
  return NextResponse.json({ url, fileName: file.name, fileType });
}
