import path from "path";
import { randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { toProtectedUploadUrl } from "@/lib/upload-urls";
import { getUploadPath, getUploadUrl, sanitizeFileName } from "@/lib/uploads";

export const runtime = "nodejs";

const AVATAR_MIME_BY_EXTENSION: Record<string, string> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;

function getExistingAvatarFilePath(avatarPath: string | null) {
  if (!avatarPath) return null;

  const prefixes = ["/uploads/avatars/", "/api/uploads/avatars/"];
  const prefix = prefixes.find((value) => avatarPath.startsWith(value));
  if (!prefix) return null;

  try {
    const fileName = decodeURIComponent(avatarPath.slice(prefix.length));
    if (!fileName || path.basename(fileName) !== fileName) return null;
    return getUploadPath("avatars", fileName);
  } catch {
    return null;
  }
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { avatarPath: true },
  });
  if (!account) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  return NextResponse.json({
    avatarPath: toProtectedUploadUrl(account.avatarPath),
  });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const formData = await request.formData();
  const targetUserId = String(formData.get("userId") || "");
  if (!targetUserId || targetUserId !== user.id) {
    return NextResponse.json({ error: "只能修改自己的头像" }, { status: 403 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请选择头像文件" }, { status: 400 });
  }

  const extension = path.extname(file.name).toLowerCase();
  if (
    !AVATAR_MIME_BY_EXTENSION[extension] ||
    AVATAR_MIME_BY_EXTENSION[extension] !== file.type
  ) {
    return NextResponse.json(
      { error: "头像仅支持 JPG、JPEG、PNG 或 WEBP 图片" },
      { status: 400 },
    );
  }
  if (file.size > MAX_AVATAR_SIZE) {
    return NextResponse.json(
      { error: "头像大小不能超过 2MB" },
      { status: 400 },
    );
  }

  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { avatarPath: true },
  });
  if (!account) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  const uploadDir = getUploadPath("avatars");
  await mkdir(uploadDir, { recursive: true });

  const fileName = `${randomUUID()}_${sanitizeFileName(file.name)}`;
  const filePath = getUploadPath("avatars", fileName);
  const storedAvatarPath = getUploadUrl("avatars", fileName);
  let newFileWritten = false;

  try {
    const bytes = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(bytes), { flag: "wx" });
    newFileWritten = true;

    const updated = await prisma.$transaction(async (tx) => {
      const after = await tx.user.update({
        where: { id: user.id },
        data: { avatarPath: storedAvatarPath },
        select: { avatarPath: true, id: true },
      });

      await writeOperationLog(tx, {
        userId: user.id,
        action: "UPDATE_OWN_AVATAR",
        entityType: "User",
        entityId: user.id,
        beforeData: { avatarPath: account.avatarPath },
        afterData: { avatarPath: after.avatarPath },
      });

      return after;
    });

    const previousFilePath = getExistingAvatarFilePath(account.avatarPath);
    if (previousFilePath && previousFilePath !== filePath) {
      await unlink(previousFilePath).catch(() => undefined);
    }

    return NextResponse.json({
      avatarPath: toProtectedUploadUrl(updated.avatarPath),
    });
  } catch {
    if (newFileWritten) {
      await unlink(filePath).catch(() => undefined);
    }
    return NextResponse.json({ error: "头像上传失败，请重试" }, { status: 500 });
  }
}
