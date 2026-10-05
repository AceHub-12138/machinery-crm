import path from "node:path";
import type { XiaochuanConfig } from "@/lib/agent/config";
import type { XiaochuanAttachment } from "@/lib/agent/attachments";
import { readXiaochuanAttachment } from "@/lib/agent/read-attachment";
import { analyzeCadAttachment } from "@/lib/agent/cad/analyze";

/**
 * 小川图纸分析（第 2 期段 3；2026-09 一期扩展 PDF 视觉）：让小川真正"看到"附件内容。
 *
 * - 图片：调 K2.6 视觉（与对话同一模型/Key，用户拍板不加第二个模型），
 *   按读图提示词产出结构化观察报告；
 * - PDF：unpdf 提取内嵌文字；2026-09 一期起，前端会把 PDF 每页渲染成
 *   《原名》-第N页.jpg 的派生图片一并上传（见 lib/xiaochuan/pdf-page-render.ts），
 *   这些派生页按普通图片走视觉通道、用工程图纸专用提示词识别——图纸的
 *   图形/尺寸/公差第一次能被看到；纯文字提取继续兜底（扫描件等场景）；
 * - CAD（DXF/DWG）：段 4 接入；DWG 需服务器装 ODA File Converter，未装则降级提示；
 * - 任何一步失败都静默降级为"看不到内容"的注记，绝不阻断对话。
 *
 * 安全边界：读文件前重新校验文件名（防路径穿越）；图片外发给硅基流动
 * 是用户知情拍板的方案；提取结果只进当轮模型上下文，不落库。
 */

export const VISION_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const VISION_MAX_PDF_BYTES = 20 * 1024 * 1024;

const IMAGE_PROMPT = [
  "你是机械加工行业的读图助手。仔细观察这张图片，用简洁的中文条目输出图上与加工相关的信息：",
  "1. 工件类型（轴/盘/齿轮/板类/箱体等，看不准就写看不准）；",
  "2. 图上标注的尺寸（逐条列出数字与单位，例如：键槽宽12mm、深5mm、长50mm、外径φ240）；",
  "3. 齿轮参数（模数/齿数/压力角/齿宽，如有）；",
  "4. 公差与表面粗糙度标注（如有）；",
  "5. 材料、热处理与技术要求等文字（如有）；",
  "6. 其他对选择机床有用的信息（如批量、装夹特征）。",
  "要求：只写图中确实可见的内容，看不清或没有的项目写「图中未见」；禁止凭经验推测图中没有的尺寸。",
  "总输出控制在 400 字以内。",
].join("\n");

/** PDF 图纸派生页（前端把 PDF 页渲染成图片）的专用读图提示词：多了标题栏与视图说明 */
const DRAWING_PAGE_PROMPT = [
  "这是工程图纸 PDF 的其中一页图片，页面可能包含零件视图、尺寸标注、标题栏或技术要求。请仔细观察，用简洁的中文条目输出：",
  "1. 工件类型与结构（轴/盘/齿轮/板类/箱体等，看不准就写看不准）；",
  "2. 图上标注的尺寸（逐条列出数字与单位，例如：外径φ240、中心孔φ60、厚45）；",
  "3. 齿轮参数（模数/齿数/压力角/齿宽，如有）；",
  "4. 公差与表面粗糙度标注（如有）；",
  "5. 标题栏信息：图号、零件名称、比例、材料（如有）；",
  "6. 技术要求文字（热处理、倒角、未注公差等，如有）。",
  "要求：只写图中确实可见的内容，看不清或没有的项目写「图中未见」；禁止凭经验推测图中没有的尺寸。",
  "总输出控制在 400 字以内。",
].join("\n");

/** 前端派生的 PDF 页面图命名规则：《原名》-第N页.jpg（与 XiaochuanChat 的 uploadPdfPageImages 保持一致） */
const PDF_PAGE_IMAGE_RE = /-第(\d+)页\.jpe?g$/i;

function pdfSourceNameFromPageImage(fileName: string) {
  return `${fileName.replace(PDF_PAGE_IMAGE_RE, "")}.pdf`;
}

/** 视觉接口的 data URL MIME 从扩展名推导——客户端声明的 type 不可靠（可能缺失或为 octet-stream） */
const VISION_MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
};

function visionMimeFromName(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  return VISION_MIME_BY_EXT[ext] ?? "image/png";
}

/** 单张图片 → 视觉模型观察报告；失败返回 null（失败原因写服务端日志，便于排障）。
 *  prompt 可选：PDF 图纸派生页用专用读图提示词 */
async function analyzeImageByVision(
  bytes: Buffer,
  fileName: string,
  config: XiaochuanConfig,
  timeoutMs: number,
  prompt: string = IMAGE_PROMPT,
): Promise<string | null> {
  const dataUrl = `data:${visionMimeFromName(fileName)};base64,${bytes.toString("base64")}`;
  const body = JSON.stringify({
    model: config.visionModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: prompt },
        ],
      },
    ],
    max_tokens: 1_200,
    // 注意：不带 enable_thinking——K2.6 认识它，但 Qwen3-VL 等专用视觉模型会报 20015 参数不支持
    stream: false,
  });
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
      console.error(`[vision] 读图失败 ${fileName}: HTTP ${response.status} ${detail}`);
      return null;
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    const text = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part) => part?.text ?? "").join("")
        : "";
    if (!text.trim()) {
      console.error(`[vision] 读图返回空内容 ${fileName}（模型 ${config.visionModel}）`);
      return null;
    }
    return text.trim();
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[vision] 读图异常 ${fileName}（模型 ${config.visionModel}，超时 ${timeoutMs}ms）: ${reason}`);
    return null;
  }
}

/** PDF → 内嵌文字提取；失败返回 null */
async function extractPdfText(bytes: Buffer): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const merged = (Array.isArray(text) ? text.join("\n") : text).replace(/\s{3,}/g, "  ").trim();
    return merged.length > 0 ? merged.slice(0, 4_000) : null;
  } catch {
    return null;
  }
}

/** 安全读取附件文件：相对路径段再次校验（与 parseChatAttachments 同一形态规则），防路径穿越。
 *  归属校验（目录 ID 必须等于对话者本人）已在 chat 入口的 parseChatAttachments 完成，这里做读取侧纵深防御。 */
async function readAttachmentBytes(attachment: XiaochuanAttachment): Promise<Buffer | null> {
  return readXiaochuanAttachment(attachment.url);
}

export type AttachmentAnalysis = {
  attachment: XiaochuanAttachment;
  /** 分析成功与否；失败时 note 为 null（上层回退到"看不到内容"话术） */
  note: string | null;
};

/** 分析单个附件（图片→视觉 / PDF→文字提取 / CAD→几何解析） */
export async function analyzeAttachment(
  attachment: XiaochuanAttachment,
  config: XiaochuanConfig,
): Promise<AttachmentAnalysis> {
  if (attachment.kind === "cad") {
    // 段 4：DXF 直接解析；DWG 经 ODA 转换（服务器未装则降级提示）
    return { attachment, note: await analyzeCadAttachment(attachment) };
  }
  const limit = attachment.kind === "image" ? VISION_MAX_IMAGE_BYTES : VISION_MAX_PDF_BYTES;
  if (attachment.size > limit) {
    return {
      attachment,
      note: `文件较大（超过${Math.round(limit / 1024 / 1024)}MB），本期暂不分析内容，请用户压缩或截图后重试。`,
    };
  }
  const bytes = await readAttachmentBytes(attachment);
  if (!bytes) return { attachment, note: null };

  if (attachment.kind === "image") {
    // PDF 图纸派生页（前端渲染的《原名》-第N页.jpg）走专用提示词，注记标明来源 PDF 与页码
    const pageMatch = PDF_PAGE_IMAGE_RE.exec(attachment.name);
    if (pageMatch) {
      const sourceName = pdfSourceNameFromPageImage(attachment.name);
      const report = await analyzeImageByVision(bytes, attachment.name, config, config.visionTimeoutMs, DRAWING_PAGE_PROMPT);
      return {
        attachment,
        note: report
          ? `【PDF 图纸页面识别（来自《${sourceName}》第 ${pageMatch[1]} 页的画面）】\n${report}`
          : null,
      };
    }
    const report = await analyzeImageByVision(bytes, attachment.name, config, config.visionTimeoutMs);
    return { attachment, note: report ? `【图片读图结果】\n${report}` : null };
  }
  const text = await extractPdfText(bytes);
  return {
    attachment,
    note: text
      ? `【PDF 文字提取结果】（以下是 PDF 内嵌文字；若本条消息同时附有本 PDF 的页面图片，画面信息以页面图片的识别结果为准）\n${text}`
      : "【PDF 文字提取结果】未能提取到文字（可能是纯图片型扫描件，需依赖同消息的页面图片识别；若没有页面图片则本期无法识别其内容）。",
  };
}

/**
 * 全部附件 → 给模型的上下文注记。
 * 图片/PDF 至少一个成功时用分析结果；全部失败时回退到段 2 的"看不到内容"话术。
 */
export function buildAttachmentAnalysisNote(analyses: AttachmentAnalysis[]): string {
  if (!analyses.length) return "";
  const KIND_LABELS = { image: "图片", pdf: "PDF 文档", cad: "CAD 图纸" } as const;
  const sections = analyses.map(({ attachment, note }) => {
    const header = `《${attachment.name}》[${KIND_LABELS[attachment.kind]}]`;
    return note ? `${header} 分析结果：\n${note}` : `${header}：本期未能读取内容，请用户用文字补充关键信息。`;
  });
  return [
    `（用户随本条消息上传了 ${analyses.length} 个附件，系统已自动分析，结果如下。`,
    "请基于分析结果与用户问题回答；分析结果里没有的信息不要编造，可请用户补充。）",
    ...sections,
  ].join("\n");
}

/** chat route 入口：并行分析全部附件（单个失败不影响其余） */
export async function analyzeAttachmentsForTurn(
  attachments: XiaochuanAttachment[],
  config: XiaochuanConfig,
): Promise<string> {
  if (!attachments.length) return "";
  const analyses = await Promise.all(attachments.map((attachment) => analyzeAttachment(attachment, config)));
  return buildAttachmentAnalysisNote(analyses);
}
