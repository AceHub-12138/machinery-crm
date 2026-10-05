import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { getUploadPath } from "@/lib/uploads";
import { isUploadPathSafe } from "@/lib/agent/upload-scope";

/** 调用前须经 parseChatAttachments 归属校验；本层保证解析器不会跨目录或跟随越权链接。 */
export async function readXiaochuanAttachment(url: string): Promise<Buffer | null> {
  const prefix = "/uploads/xiaochuan/";
  if (!url.startsWith(prefix)) return null;
  let segments: string[];
  try { segments = url.slice(prefix.length).split("/").map(decodeURIComponent); } catch { return null; }
  if (!isUploadPathSafe(["xiaochuan", ...segments])) return null;
  if (segments.length !== 1 && !(segments.length === 3 && ["crm", "agent-account"].includes(segments[0]))) return null;
  try {
    const root = await realpath(getUploadPath("xiaochuan"));
    const target = await realpath(getUploadPath("xiaochuan", ...segments));
    const authorized = segments.length === 3 ? path.join(root, ...segments.slice(0, 2)) : root;
    const relative = path.relative(authorized, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return await readFile(target);
  } catch { return null; }
}
