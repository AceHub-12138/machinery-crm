import type { XiaochuanViewer } from "@/lib/agent/auth";

/** 新上传的小川附件按身份类型和账号 ID 分目录，文件路径本身携带归属。 */
export function xiaochuanUploadScope(viewer: XiaochuanViewer): ["xiaochuan", "crm" | "agent-account", string] {
  return viewer.kind === "agent-account"
    ? ["xiaochuan", "agent-account", viewer.account.id]
    : ["xiaochuan", "crm", viewer.user.id];
}

/** Next 已解码路径段；禁止把斜杠、目录跳转或 Windows 分隔符藏在单个段中。 */
export function isUploadPathSafe(pathSegments: string[]) {
  return pathSegments.length >= 2 && pathSegments.every((segment) =>
    Boolean(segment) && segment !== "." && segment !== ".." && !/[\\/\0]/.test(segment),
  );
}

/** 目录级权限；业务附件的区域/实体权限与历史附件归属由读取接口进一步核实。 */
export function canReadProtectedUpload(viewer: XiaochuanViewer, pathSegments: string[]) {
  if (!isUploadPathSafe(pathSegments)) return false;
  if (pathSegments[0] === "xiaochuan") {
    // 旧扁平文件没有目录归属，只允许 CRM 身份进入历史消息归属校验。
    if (pathSegments.length === 2) return viewer.kind === "crm";
    const scope = xiaochuanUploadScope(viewer);
    return pathSegments.length === 4 && scope.every((segment, index) => pathSegments[index] === segment);
  }
  if (viewer.kind !== "crm") return false;
  const role = viewer.user.role;
  if (!["SUPER_ADMIN", "SALES", "FOREIGN_TRADE", "WAREHOUSE", "PURCHASE"].includes(role)) return false;
  if (pathSegments[0] === "avatars" || pathSegments[0] === "erp") return true;
  return ["SUPER_ADMIN", "SALES", "FOREIGN_TRADE"].includes(role)
    && ["contracts", "shipments", "products"].includes(pathSegments[0]);
}
