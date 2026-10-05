import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  attachmentKindFromName,
  attachmentMagicMatches,
  buildAttachmentContextNote,
  isAllowedAttachmentExtension,
  parseChatAttachments,
  sanitizeAttachmentName,
} from "@/lib/agent/attachments";

function bytes(...values: Array<number | string | number[]>) {
  const parts = values.map((value) =>
    typeof value === "string" ? Buffer.from(value, "latin1") : Buffer.from(value as ArrayLike<number>),
  );
  return new Uint8Array(Buffer.concat(parts));
}

function validAttachment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    url: "/uploads/xiaochuan/1725400000-abc.png",
    name: "键槽图纸.png",
    type: "image/png",
    size: 123_456,
    kind: "image",
    ...overrides,
  };
}

const CRM_OWNER = { kind: "crm" as const, id: "user-1" };
const AGENT_OWNER = { kind: "agent-account" as const, id: "agent-9" };
/** 旧扁平路径用员工身份（历史兼容），新多层路径默认指向员工本人目录 */
const CRM_OWN_FILE = { ...validAttachment(), url: "/uploads/xiaochuan/crm/user-1/1725400000-abc.png" };

describe("attachmentKindFromName / isAllowedAttachmentExtension", () => {
  it("图片、PDF、CAD 扩展名归类正确", () => {
    expect(attachmentKindFromName("a.JPG")).toBe("image");
    expect(attachmentKindFromName("b.png")).toBe("image");
    expect(attachmentKindFromName("c.pdf")).toBe("pdf");
    expect(attachmentKindFromName("d.dxf")).toBe("cad");
    expect(attachmentKindFromName("e.DWG")).toBe("cad");
  });

  it("可执行文件与未知扩展名一律拒绝", () => {
    expect(isAllowedAttachmentExtension("virus.exe")).toBe(false);
    expect(isAllowedAttachmentExtension("noext")).toBe(false);
    expect(isAllowedAttachmentExtension("script.js")).toBe(false);
    expect(isAllowedAttachmentExtension("photo.heic")).toBe(false);
  });
});

describe("sanitizeAttachmentName", () => {
  it("去路径、去非法字符、限长", () => {
    expect(sanitizeAttachmentName("..\\..\\etc\\passwd.png")).toBe("passwd.png");
    expect(sanitizeAttachmentName("图纸<>|.pdf")).toBe("图纸___.pdf");
    expect(sanitizeAttachmentName("x".repeat(200) + ".png").length).toBeLessThanOrEqual(120);
  });
});

describe("attachmentMagicMatches", () => {
  it("真实格式的文件头通过（含空字节的二进制文件不再被误杀）", () => {
    // PNG 头本身含 0x00 字节——回归用例：段 2 首版的 NUL 内容检查会把所有二进制文件拒掉
    const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(attachmentMagicMatches("a.png", png)).toBe(true);
    expect(attachmentMagicMatches("a.jpg", bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(attachmentMagicMatches("a.gif", bytes("GIF89a"))).toBe(true);
    expect(attachmentMagicMatches("a.bmp", bytes("BM"))).toBe(true);
    expect(attachmentMagicMatches("a.webp", bytes("RIFF", [0, 0, 0, 0], "WEBP"))).toBe(true);
    expect(attachmentMagicMatches("a.pdf", bytes("%PDF-1.4"))).toBe(true);
  });

  it("DXF/DWG 本期不做魔数深校验，非空即过", () => {
    expect(attachmentMagicMatches("a.dxf", bytes("999\n注释"))).toBe(true);
    expect(attachmentMagicMatches("a.dwg", bytes("AC1024"))).toBe(true);
  });

  it("改扩展名的伪装文件被拒", () => {
    expect(attachmentMagicMatches("virus.png", bytes("MZ\x90\x00"))).toBe(false);
    expect(attachmentMagicMatches("fake.pdf", bytes("hello text"))).toBe(false);
    expect(attachmentMagicMatches("fake.jpg", bytes("<script>"))).toBe(false);
  });
});

describe("parseChatAttachments", () => {
  it("缺省/为空时通过，返回空数组", () => {
    expect(parseChatAttachments(undefined, CRM_OWNER)).toEqual({ ok: true, attachments: [] });
    expect(parseChatAttachments([], CRM_OWNER)).toEqual({ ok: true, attachments: [] });
  });

  it("合法附件通过：员工本人目录三层路径与历史扁平路径均可", () => {
    const scoped = parseChatAttachments([CRM_OWN_FILE], CRM_OWNER);
    expect(scoped.ok).toBe(true);
    if (scoped.ok) expect(scoped.attachments[0]?.url).toContain("/uploads/xiaochuan/");

    const legacy = parseChatAttachments([validAttachment()], CRM_OWNER);
    expect(legacy.ok).toBe(true);
  });

  it("Agent 独立账号：本人归属目录路径通过", () => {
    const own = validAttachment({ url: `/uploads/xiaochuan/agent-account/${AGENT_OWNER.id}/f.png` });
    expect(parseChatAttachments([own], AGENT_OWNER).ok).toBe(true);
  });

  it("归属越权拒绝：他人目录 / 他人账号段 / Agent 用历史扁平路径", () => {
    // 员工提交别的员工目录下的文件
    expect(parseChatAttachments(
      [validAttachment({ url: "/uploads/xiaochuan/crm/other-user/x.png" })],
      CRM_OWNER,
    ).ok).toBe(false);
    // 员工提交 Agent 账号目录下的文件
    expect(parseChatAttachments(
      [validAttachment({ url: `/uploads/xiaochuan/agent-account/${AGENT_OWNER.id}/f.png` })],
      CRM_OWNER,
    ).ok).toBe(false);
    // Agent 提交别的 Agent 目录
    expect(parseChatAttachments(
      [validAttachment({ url: "/uploads/xiaochuan/agent-account/agent-other/f.png" })],
      AGENT_OWNER,
    ).ok).toBe(false);
    // Agent 提交旧扁平路径（该名单从无扁平文件，拒绝即封死跨账号读取）
    expect(parseChatAttachments([validAttachment()], AGENT_OWNER).ok).toBe(false);
    // Agent 提交员工目录
    expect(parseChatAttachments(
      [validAttachment({ url: "/uploads/xiaochuan/crm/user-1/f.png" })],
      AGENT_OWNER,
    ).ok).toBe(false);
  });

  it("非白名单目录前缀直接拒绝（防把任意 /uploads 路径塞进对话）", () => {
    const result = parseChatAttachments([validAttachment({ url: "/uploads/contracts/secret.pdf" })], CRM_OWNER);
    expect(result.ok).toBe(false);
  });

  it("路径穿越拒绝", () => {
    expect(parseChatAttachments([validAttachment({ url: "/uploads/xiaochuan/..%2F..%2Fx.png" })], CRM_OWNER).ok).toBe(false);
    expect(parseChatAttachments([validAttachment({ url: "/uploads/xiaochuan/a/b.png" })], CRM_OWNER).ok).toBe(false);
    expect(parseChatAttachments(
      [validAttachment({ url: `/uploads/xiaochuan/crm/${CRM_OWNER.id}/..%2Fx.png` })],
      CRM_OWNER,
    ).ok).toBe(false);
    expect(parseChatAttachments(
      [validAttachment({ url: `/uploads/xiaochuan/crm/${CRM_OWNER.id}/sub/x.png` })],
      CRM_OWNER,
    ).ok).toBe(false);
  });

  it("超过数量上限拒绝", () => {
    const many = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 1 }, () => CRM_OWN_FILE);
    expect(parseChatAttachments(many, CRM_OWNER).ok).toBe(false);
  });

  it("超过大小上限拒绝", () => {
    expect(parseChatAttachments([{ ...CRM_OWN_FILE, size: 21 * 1024 * 1024 }], CRM_OWNER).ok).toBe(false);
  });

  it("kind 与扩展名不一致拒绝", () => {
    expect(parseChatAttachments([{ ...CRM_OWN_FILE, kind: "cad" }], CRM_OWNER).ok).toBe(false);
  });

  it("缺字段/类型错误拒绝", () => {
    expect(parseChatAttachments([{}], CRM_OWNER).ok).toBe(false);
    expect(parseChatAttachments(["x"], CRM_OWNER).ok).toBe(false);
    expect(parseChatAttachments([{ ...CRM_OWN_FILE, size: "big" }], CRM_OWNER).ok).toBe(false);
  });

  it("type（MIME）缺失时兜底通过——回归：前端曾因漏传 type 被误拒", () => {
    const result = parseChatAttachments([{ ...CRM_OWN_FILE, type: undefined }], CRM_OWNER);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attachments[0]?.type).toBe("application/octet-stream");
  });
});

describe("buildAttachmentContextNote", () => {
  it("无附件返回空串", () => {
    expect(buildAttachmentContextNote([])).toBe("");
  });

  it("注记包含文件名与类型，并明确禁止假装看过内容", () => {
    const note = buildAttachmentContextNote([
      { url: "/uploads/xiaochuan/a.png", name: "键槽图纸.png", type: "image/png", size: 1, kind: "image" },
      { url: "/uploads/xiaochuan/b.dxf", name: "零件.dxf", type: "application/octet-stream", size: 2, kind: "cad" },
    ]);
    expect(note).toContain("键槽图纸.png");
    expect(note).toContain("零件.dxf");
    expect(note).toContain("图片");
    expect(note).toContain("CAD");
    expect(note).toContain("不要描述、猜测或假装已查看附件内容");
  });
});
