import type { XiaochuanViewer } from "@/lib/agent/auth";

/** 新上传的小川附件按身份类型和账号 ID 分目录，文件路径本身携带归属。 */
export function xiaochuanUploadScope(viewer: XiaochuanViewer): ["xiaochuan", "crm" | "agent-account", string] {
  return viewer.kind === "agent-account"
    ? ["xiaochuan", "agent-account", viewer.account.id]
    : ["xiaochuan", "crm", viewer.user.id];
}

/** CRM 员工保持既有附件访问能力；独立 Agent 账号只允许读取自己的小川附件目录。 */
export function canReadProtectedUpload(viewer: XiaochuanViewer, pathSegments: string[]) {
  if (viewer.kind === "crm") return true;
  const scope = xiaochuanUploadScope(viewer);
  return scope.every((segment, index) => pathSegments[index] === segment);
}
