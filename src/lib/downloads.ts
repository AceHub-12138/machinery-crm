import path from "path";
import { getUploadRoot } from "./uploads";

/**
 * 桌面客户端安装包/更新元数据的持久下载目录。
 * 默认挂在 uploads 根下（生产即 /opt/machinery-crm-uploads/downloads，外置持久目录，
 * 不随版本发布包覆盖丢失）；可用 DOWNLOAD_DIR 独立指定。
 * 该目录通过 /api/downloads/* 公开（免登录）：新用户未登录要能下载安装包，
 * 桌面端自动更新器也不携带会话 Cookie。
 */
export function getDownloadRoot() {
  return path.resolve(process.env.DOWNLOAD_DIR || path.join(getUploadRoot(), "downloads"));
}

/** 桌面客户端发布文件所在子目录（electron-updater feed 目录） */
export function getDesktopDownloadDir() {
  return path.join(getDownloadRoot(), "desktop");
}

/** 对外仅放开这几类文件：安装包、增量更新块图、版本清单 */
const ALLOWED_DOWNLOAD_EXTENSIONS = new Set([".exe", ".blockmap", ".yml"]);

export function isAllowedDownloadFile(fileName: string) {
  return ALLOWED_DOWNLOAD_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}
