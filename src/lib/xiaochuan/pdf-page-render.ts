"use client";

/**
 * 小川图纸识别（2026-09 一期）：在浏览器里把 PDF 每一页渲染成图片。
 *
 * 背景：服务端此前只用 unpdf 提取 PDF 内嵌文字，图纸的图形、尺寸线、公差标注
 * 全部看不到（模型只能拿到标题栏文字）。把「PDF 页面 → 图片」放在浏览器侧完成，
 * 派生图片随原 PDF 一起上传后走既有图片视觉通道——服务端因此无需安装 canvas
 * 等原生依赖，服务器部署零变更。
 *
 * 边界：
 * - 只渲染前 maxPages 页（配合每条消息 5 个附件的上限），超出由调用方提示；
 * - 长边压到 maxEdgePx 内、JPEG 0.9 质量，单页通常几百 KB，远低于 8MB 视觉上限；
 * - 任何失败向上抛错，由调用方降级为"仅按文字方式识别"（原 PDF 仍有服务端
 *   unpdf 文字提取兜底），绝不阻断消息发送。
 */

export type PdfPageImage = {
  pageNumber: number;
  blob: Blob;
  width: number;
  height: number;
};

/** 单份 PDF 默认最多转出的页面图片数（附件总上限 5 = PDF 本体 1 + 派生页 4） */
export const PDF_PAGE_RENDER_LIMIT = 4;
const MAX_EDGE_PX = 2000;

export async function renderPdfPagesToImages(
  file: File,
  options: { maxPages?: number; maxEdgePx?: number } = {},
): Promise<{ pages: PdfPageImage[]; totalPages: number }> {
  const maxPages = options.maxPages ?? PDF_PAGE_RENDER_LIMIT;
  const maxEdgePx = options.maxEdgePx ?? MAX_EDGE_PX;

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;
  const pages: PdfPageImage[] = [];
  try {
    const totalPages = doc.numPages;
    const pageCount = Math.min(totalPages, maxPages);
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(
        maxEdgePx / Math.max(base.width, 1),
        maxEdgePx / Math.max(base.height, 1),
        4,
      );
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext("2d");
      if (!context) throw new Error(`第 ${pageNumber} 页画布创建失败`);
      // JPEG 无透明通道，先铺白底，避免透明区域被压成黑色
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      const width = canvas.width;
      const height = canvas.height;
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) throw new Error(`第 ${pageNumber} 页导出失败`);
      pages.push({ pageNumber, blob, width, height });
    }
    return { pages, totalPages };
  } finally {
    // v6 起销毁入口在 loading task 上（同时回收 worker）
    await loadingTask.destroy().catch(() => undefined);
  }
}
