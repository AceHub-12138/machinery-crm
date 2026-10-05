/**
 * 小川附件（第 2 期段 2）：类型定义、上传白名单与请求校验。
 *
 * 段 2 边界（拍板）：先做到「存得下、看得见」——附件上传/落库/历史回放/鉴权查看，
 * 小川本期只能看到文件名（buildAttachmentContextNote 里向模型说明），
 * 图片/PDF/CAD 内容解析在段 3/4 接入。
 */

export type XiaochuanAttachmentKind = "image" | "pdf" | "cad";

export type XiaochuanAttachment = {
  /** 逻辑 URL，形如 /uploads/xiaochuan/<文件名>；展示时经 toProtectedUploadUrl 转鉴权代理地址 */
  url: string;
  /** 用户上传时的原始文件名（仅展示用） */
  name: string;
  type: string;
  size: number;
  kind: XiaochuanAttachmentKind;
};

export const XIAOCHUAN_ATTACHMENT_URL_PREFIX = "/uploads/xiaochuan/";
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export const ATTACHMENT_EXTENSIONS_BY_KIND: Record<XiaochuanAttachmentKind, readonly string[]> = {
  image: [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"],
  pdf: [".pdf"],
  cad: [".dxf", ".dwg"],
};

const ALL_ALLOWED_EXTENSIONS = new Set(
  Object.values(ATTACHMENT_EXTENSIONS_BY_KIND).flat(),
);

const ACCEPT_ATTRIBUTE = Object.values(ATTACHMENT_EXTENSIONS_BY_KIND)
  .flat()
  .join(",");

export function attachmentAcceptAttribute() {
  return ACCEPT_ATTRIBUTE;
}

export function attachmentKindFromName(fileName: string): XiaochuanAttachmentKind | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = fileName.slice(dot).toLowerCase();
  for (const [kind, extensions] of Object.entries(ATTACHMENT_EXTENSIONS_BY_KIND)) {
    if ((extensions as readonly string[]).includes(ext)) return kind as XiaochuanAttachmentKind;
  }
  return null;
}

export function isAllowedAttachmentExtension(fileName: string) {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return false;
  return ALL_ALLOWED_EXTENSIONS.has(fileName.slice(dot).toLowerCase());
}

/** 图片扩展名对应的期望 MIME 前缀（上传时粗校验，防改扩展名绕过）；非图片类按扩展名为准 */
export function mimeMatchesKind(kind: XiaochuanAttachmentKind, mime: string) {
  const normalized = mime.toLowerCase();
  if (kind === "image") return normalized.startsWith("image/");
  if (kind === "pdf") return normalized === "application/pdf" || normalized === "application/octet-stream";
  // DXF/DWG 无统一 MIME，客户端多为 application/octet-stream 或空
  return normalized === "" || normalized === "application/octet-stream" || normalized.startsWith("image/");
}

/** 去掉路径部分与非法字符，限制长度；仅作展示名 */
export function sanitizeAttachmentName(fileName: string) {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, "_").trim();
  return cleaned.slice(0, 120) || "附件";
}

/**
 * 文件头（魔数）校验：防把可执行文件改扩展名伪装上传。
 * 图片与 PDF 的格式头固定可靠；DXF 为文本、DWG 版本头多样，段 4 解析时再深校验。
 */
export function attachmentMagicMatches(fileName: string, bytes: Uint8Array): boolean {
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
  const head = (length: number) => bytes.subarray(0, length);
  const headText = (length: number) => Buffer.from(bytes.subarray(0, length)).toString("latin1");

  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return head(3).length >= 3 && head(3)[0] === 0xff && head(3)[1] === 0xd8 && head(3)[2] === 0xff;
    case ".png":
      return headText(4) === "\x89PNG";
    case ".gif":
      return headText(4) === "GIF8";
    case ".bmp":
      return headText(2) === "BM";
    case ".webp":
      return bytes.length >= 12 && headText(4) === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("latin1") === "WEBP";
    case ".pdf":
      return headText(5) === "%PDF-";
    case ".dxf":
    case ".dwg":
      return true;
    default:
      return false;
  }
}

/**
 * 校验 chat 请求体里的 attachments 字段。
 * 安全边界：url 必须在本期附件目录前缀下、路径段与当前对话者归属一致、数量与大小设上限、kind 与扩展名一致。
 *
 * 归属规则（与 upload-scope.ts 的多层目录一一对应）：
 * - 新路径 `/uploads/xiaochuan/{crm|agent-account}/{归属ID}/{文件名}`：归属 ID 必须等于当前对话者本人；
 * - 旧扁平路径 `/uploads/xiaochuan/{文件名}`：仅 CRM 员工放行（历史会话回放/重试兼容），
 *   Agent 独立账号一律拒绝——该名单从无扁平历史文件，拒绝即可封死跨账号读取。
 */
export type XiaochuanAttachmentOwner = { kind: "crm" | "agent-account"; id: string };

const OWNER_SEGMENT_BY_KIND = { crm: "crm", "agent-account": "agent-account" } as const;

function isUnsafeSegment(segment: string) {
  return !segment || segment.includes("..") || segment.includes("\\") || segment.includes("/") || segment.includes("\0");
}

export function parseChatAttachments(
  input: unknown,
  owner: XiaochuanAttachmentOwner,
): { ok: true; attachments: XiaochuanAttachment[] } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, attachments: [] };
  if (!Array.isArray(input)) return { ok: false, error: "附件格式无效" };
  if (input.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return { ok: false, error: `每条消息最多带 ${MAX_ATTACHMENTS_PER_MESSAGE} 个附件` };
  }

  const attachments: XiaochuanAttachment[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: "附件格式无效" };
    }
    const item = raw as Record<string, unknown>;
    const { url, name, type, size, kind } = item;
    if (typeof url !== "string" || !url.startsWith(XIAOCHUAN_ATTACHMENT_URL_PREFIX)) {
      return { ok: false, error: "附件地址无效" };
    }
    // 相对路径按段校验：只接受「本人归属目录三层路径」或（仅员工）历史单层文件名
    const relative = url.slice(XIAOCHUAN_ATTACHMENT_URL_PREFIX.length);
    const segments = relative.split("/");
    let storedName: string;
    if (segments.length === 3) {
      const [ownerSegment, ownerSegmentId, fileName] = segments;
      if (ownerSegment !== OWNER_SEGMENT_BY_KIND[owner.kind]) {
        return { ok: false, error: "附件不属于当前账号" };
      }
      if (ownerSegmentId !== owner.id || isUnsafeSegment(fileName)) {
        return { ok: false, error: "附件不属于当前账号" };
      }
      storedName = fileName;
    } else if (segments.length === 1 && owner.kind === "crm") {
      if (isUnsafeSegment(segments[0])) return { ok: false, error: "附件地址无效" };
      storedName = segments[0];
    } else {
      return { ok: false, error: "附件不属于当前账号" };
    }
    if (!storedName) return { ok: false, error: "附件地址无效" };
    if (typeof name !== "string" || !name.trim()) return { ok: false, error: "附件名无效" };
    // type（MIME）是客户端声明值、可伪造，仅作展示：缺失或非法时兜底，不做硬校验
    const safeType = typeof type === "string" && type.trim() ? type : "application/octet-stream";
    if (typeof size !== "number" || !Number.isFinite(size) || size < 0 || size > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: "附件超过大小限制（单文件 20MB）" };
    }
    const resolvedKind = attachmentKindFromName(storedName) ?? attachmentKindFromName(name);
    if (resolvedKind === null || resolvedKind !== kind) return { ok: false, error: "附件类型与文件不一致" };
    attachments.push({ url, name: sanitizeAttachmentName(name), type: safeType, size, kind: resolvedKind });
  }
  return { ok: true, attachments };
}

/** 给大脑的附件注记：本期模型只能看到文件名，明确不许假装看过内容 */
export function buildAttachmentContextNote(attachments: XiaochuanAttachment[]) {
  if (!attachments.length) return "";
  const KIND_LABELS: Record<XiaochuanAttachmentKind, string> = {
    image: "图片",
    pdf: "PDF 文档",
    cad: "CAD 图纸",
  };
  const list = attachments
    .map((attachment) => `《${attachment.name}》[${KIND_LABELS[attachment.kind]}]`)
    .join("、");
  return [
    `（用户随本条消息上传了 ${attachments.length} 个附件：${list}。`,
    "附件的画面内容你目前还看不到——图纸解析功能尚未开通，请不要描述、猜测或假装已查看附件内容；",
    "如需要图纸细节，请告诉用户：图片与 CAD 解析即将开通，先请他用文字补充关键尺寸。）",
  ].join("");
}
