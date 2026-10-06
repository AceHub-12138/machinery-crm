import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getXiaochuanViewer } from "@/lib/agent/auth";
import { getContentType, getUploadRoot, getUploadUrl } from "@/lib/uploads";
import { canReadProtectedUpload, isUploadPathSafe } from "@/lib/agent/upload-scope";
import { prisma } from "@/lib/db";
import { buildCustomerWhereClause } from "@/lib/customer-permissions";
import { canViewAttachmentEntity } from "@/lib/erp-attachments";
import { ownsLegacyXiaochuanUpload } from "@/lib/agent/legacy-upload-owner";
import type { XiaochuanViewer } from "@/lib/agent/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isInsideBaseDir(baseDir: string, filePath: string) {
  const relativePath = path.relative(baseDir, filePath);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

async function canReadBusinessUpload(viewer: XiaochuanViewer, segments: string[]) {
  if (viewer.kind !== "crm") return true; // 已通过自己的小川目录校验。
  const user = viewer.user;
  const fileUrl = getUploadUrl(...segments);
  const urls = [fileUrl, `/api${fileUrl}`];
  if (segments[0] === "xiaochuan" && segments.length === 2) {
    // 历史文件按已有对话记录判断归属，不搬文件、不改数据库。
    return ownsLegacyXiaochuanUpload(user.id, fileUrl);
  }
  if (segments[0] === "contracts" && user.role !== "SUPER_ADMIN") {
    const visible = await prisma.contract.findFirst({
      where: { attachmentUrl: { in: urls }, deletedAt: null, customer: buildCustomerWhereClause(user) },
      select: { id: true },
    });
    if (visible) return true;
    // 上传后、保存合同前，只有上传者能预览；一旦关联业务记录就必须遵循区域权限。
    if (segments.length !== 4 || segments[1] !== "crm" || segments[2] !== user.id) return false;
    return !await prisma.contract.findFirst({ where: { attachmentUrl: { in: urls } }, select: { id: true } });
  }
  if (segments[0] === "shipments" && user.role !== "SUPER_ADMIN") {
    const visible = await prisma.shipment.findFirst({
      where: {
        OR: [{ deliveryNoteUrl: { in: urls } }, { shipmentPhotoUrl: { in: urls } }],
        contract: { deletedAt: null, customer: buildCustomerWhereClause(user) },
      },
      select: { id: true },
    });
    if (visible) return true;
    if (segments.length !== 5 || segments[1] !== "crm" || segments[2] !== user.id) return false;
    return !await prisma.shipment.findFirst({
      where: { OR: [{ deliveryNoteUrl: { in: urls } }, { shipmentPhotoUrl: { in: urls } }] },
      select: { id: true },
    });
  }
  if (segments[0] === "erp") {
    const attachment = await prisma.erpAttachment.findFirst({
      where: { fileUrl: { in: urls }, deletedAt: null },
      select: { entityType: true, entityId: true },
    });
    return Boolean(attachment && await canViewAttachmentEntity(user, attachment.entityType, attachment.entityId));
  }
  return true;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // 双身份鉴权：CRM 员工（NextAuth）或 Agent 独立账号（小川附件/头像读取）
  const viewer = await getXiaochuanViewer();
  if (!viewer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { path: pathSegments } = await params;
  if (!pathSegments || !isUploadPathSafe(pathSegments)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  if (!canReadProtectedUpload(viewer, pathSegments) || !await canReadBusinessUpload(viewer, pathSegments)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const baseDir = path.resolve(getUploadRoot());
  const filePath = path.resolve(baseDir, pathSegments.join(path.sep));

  if (!isInsideBaseDir(baseDir, filePath)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const realBaseDir = fs.realpathSync(baseDir);
    const realFilePath = fs.realpathSync(filePath);

    // realpath 还必须留在授权目录内，防止同一上传根目录中的符号链接跨账号/跨业务目录。
    const scoped = pathSegments[0] === "xiaochuan" && pathSegments.length === 4
      || ["contracts", "shipments"].includes(pathSegments[0]) && pathSegments[1] === "crm";
    const scopeLength = scoped ? 3 : 1;
    const authorizedDir = path.join(realBaseDir, ...pathSegments.slice(0, scopeLength));

    if (!isInsideBaseDir(authorizedDir, realFilePath) || !fs.statSync(realFilePath).isFile()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return new NextResponse(fs.readFileSync(realFilePath), {
      headers: {
        "Content-Type": getContentType(realFilePath),
        "Cache-Control": "private, no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
