import { describe, expect, it, vi } from "vitest";
import { buildAttachmentAnalysisNote, analyzeAttachment } from "@/lib/agent/vision";
import { loadXiaochuanConfig } from "@/lib/agent/config";
import type { XiaochuanAttachment } from "@/lib/agent/attachments";

function attachment(overrides: Partial<XiaochuanAttachment> = {}): XiaochuanAttachment {
  return { url: "/uploads/xiaochuan/a.png", name: "图纸.png", type: "image/png", size: 1000, kind: "image", ...overrides };
}

const config = loadXiaochuanConfig({ XIAOCHUAN_LLM_API_KEY: "test-key" });

describe("analyzeAttachment", () => {
  it("CAD 附件走解析管线：文件不存在时返回可读的降级话术", async () => {
    const result = await analyzeAttachment(attachment({ kind: "cad", url: "/uploads/xiaochuan/a.dxf", name: "a.dxf" }), config);
    expect(result.note).toContain("CAD 图纸");
    expect(result.note).not.toBeNull();
  });

  it("超大图片不调用视觉，返回提示性 note", async () => {
    const result = await analyzeAttachment(attachment({ size: 9 * 1024 * 1024 }), config);
    expect(result.note).toContain("8MB");
  });

  it("文件不存在时不抛错，返回 null（上层降级）", async () => {
    const result = await analyzeAttachment(attachment({ url: "/uploads/xiaochuan/not-exist.png" }), config);
    expect(result.note).toBeNull();
  });

  it("图片存在时调 K2.6 视觉并返回读图报告（mock fetch）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "- 工件类型：板类\n- 尺寸：键槽宽12mm" } }],
    }), { status: 200 })));
    // 用本地真实存在的测试文件
    const { mkdir, writeFile, rm } = await import("node:fs/promises");
    const { getUploadPath } = await import("@/lib/uploads");
    const dir = getUploadPath("xiaochuan");
    await mkdir(dir, { recursive: true });
    const storedName = "vitest-vision.png";
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 1, 2]);
    await writeFile(getUploadPath("xiaochuan", storedName), bytes);

    try {
      const result = await analyzeAttachment(attachment({ url: `/uploads/xiaochuan/${storedName}` }), config);
      expect(result.note).toContain("键槽宽12mm");
      const calledBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(calledBody.messages[0].content[0].image_url.url).toContain("data:image/png;base64,");
      expect(calledBody.enable_thinking).toBe(false);
    } finally {
      await rm(getUploadPath("xiaochuan", storedName));
      vi.unstubAllGlobals();
    }
  });
});

describe("analyzeAttachment 多层归属路径（回归：上传目录分层后读取必须跟得上）", () => {
  it("三层归属路径（agent-account/账号ID/文件名）能读到文件", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "- 工件类型：板类" } }],
    }), { status: 200 })));
    const { mkdir, writeFile, rm } = await import("node:fs/promises");
    const { getUploadPath } = await import("@/lib/uploads");
    const dir = getUploadPath("xiaochuan", "agent-account", "agent-9");
    await mkdir(dir, { recursive: true });
    const storedName = "vitest-vision-multi.png";
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 1, 2]);
    await writeFile(getUploadPath("xiaochuan", "agent-account", "agent-9", storedName), bytes);

    try {
      const result = await analyzeAttachment(
        attachment({ url: `/uploads/xiaochuan/agent-account/agent-9/${storedName}` }),
        config,
      );
      expect(result.note).toContain("板类");
    } finally {
      await rm(getUploadPath("xiaochuan", "agent-account", "agent-9", storedName));
      vi.unstubAllGlobals();
    }
  });

  it("四层及以上路径形态直接拒绝（不读文件系统）", async () => {
    const result = await analyzeAttachment(
      attachment({ url: "/uploads/xiaochuan/a/b/c.png" }),
      config,
    );
    expect(result.note).toBeNull();
  });
});

describe("buildAttachmentAnalysisNote", () => {
  it("混合附件：分析结果 + CAD 降级提示 + 失败降级各得其所", () => {
    const note = buildAttachmentAnalysisNote([
      { attachment: attachment({ name: "图1.png", kind: "image" }), note: "【图片读图结果】\n- 键槽宽12mm" },
      { attachment: attachment({ name: "零件.dxf", kind: "cad", url: "/uploads/xiaochuan/a.dxf" }), note: "【CAD 图纸解析结果】\n- 直径：φ50" },
      { attachment: attachment({ name: "失败.png", kind: "image", url: "/uploads/xiaochuan/b.png" }), note: null },
    ]);
    expect(note).toContain("键槽宽12mm");
    expect(note).toContain("φ50");
    expect(note).toContain("本期未能读取内容");
    expect(note).toContain("不要编造");
  });

  it("空附件返回空串", () => {
    expect(buildAttachmentAnalysisNote([])).toBe("");
  });
});
