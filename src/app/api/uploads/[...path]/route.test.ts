import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { getXiaochuanViewer } = vi.hoisted(() => ({
  getXiaochuanViewer: vi.fn(),
}));
const mocks = vi.hoisted(() => ({
  contract: vi.fn(), shipment: vi.fn(), erpAttachment: vi.fn(), agentMessage: vi.fn(), canViewAttachmentEntity: vi.fn(),
}));

vi.mock("@/lib/agent/auth", () => ({ getXiaochuanViewer }));
vi.mock("@/lib/db", () => ({ prisma: {
  contract: { findFirst: mocks.contract }, shipment: { findFirst: mocks.shipment },
  erpAttachment: { findFirst: mocks.erpAttachment }, agentMessage: { findFirst: mocks.agentMessage },
} }));
vi.mock("@/lib/erp-attachments", () => ({ canViewAttachmentEntity: mocks.canViewAttachmentEntity }));

import { GET } from "./route";

function requestPath(...segments: string[]) {
  return GET(
    new NextRequest(`http://localhost/api/uploads/${segments.join("/")}`),
    { params: Promise.resolve({ path: segments }) },
  );
}

describe("受保护上传文件读取", () => {
  let uploadRoot: string;
  beforeEach(() => {
    vi.resetAllMocks();
    uploadRoot = mkdtempSync(path.join(tmpdir(), "dachuan-uploads-test-"));
    vi.stubEnv("UPLOAD_DIR", uploadRoot);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(uploadRoot, { recursive: true, force: true });
  });

  function file(segments: string[], contents = "test attachment") {
    const target = path.join(uploadRoot, ...segments);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
    return target;
  }

  function crm(role = "SALES") {
    getXiaochuanViewer.mockResolvedValue({ kind: "crm", user: {
      id: "user-1", role, region: "山东", territories: [{ province: "山东省", cities: [] }], viewScope: "TERRITORY",
    } });
  }

  it("未登录返回 401，不读取业务记录", async () => {
    getXiaochuanViewer.mockResolvedValue(null);
    expect((await requestPath("contracts", "secret.pdf")).status).toBe(401);
    expect(mocks.contract).not.toHaveBeenCalled();
  });

  it("独立 Agent 账号不能读取小川目录以外的业务附件", async () => {
    getXiaochuanViewer.mockResolvedValue({ kind: "agent-account", account: { id: "agent-1" } });

    const response = await requestPath("contracts", "secret.pdf");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("独立 Agent 账号可以进入自己的小川附件读取流程", async () => {
    getXiaochuanViewer.mockResolvedValue({ kind: "agent-account", account: { id: "agent-1" } });

    const response = await requestPath("xiaochuan", "agent-account", "agent-1", "missing.png");

    expect(response.status).toBe(404);
  });

  it("独立 Agent 账号不能读取其他账号或旧版无归属的小川附件", async () => {
    getXiaochuanViewer.mockResolvedValue({ kind: "agent-account", account: { id: "agent-1" } });

    const otherAccount = await requestPath("xiaochuan", "agent-account", "agent-2", "secret.png");
    const legacyEmployeeUpload = await requestPath("xiaochuan", "legacy-secret.png");

    expect(otherAccount.status).toBe(403);
    expect(legacyEmployeeUpload.status).toBe(403);
  });

  it("CRM 员工仍可进入原有业务附件读取流程", async () => {
    crm("SUPER_ADMIN");

    const response = await requestPath("contracts", "missing.pdf");

    expect(response.status).toBe(404);
  });

  it.each(["WAREHOUSE", "PURCHASE"])("%s 不能直读合同和发货附件", async (role) => {
    crm(role);
    expect((await requestPath("contracts", "secret.pdf")).status).toBe(403);
    expect((await requestPath("shipments", "docs", "secret.pdf")).status).toBe(403);
    expect(mocks.contract).not.toHaveBeenCalled();
  });

  it.each(["SALES", "WAREHOUSE", "PURCHASE"])("%s 能读取本人小川附件，不能读取别人或 Agent 的附件", async (role) => {
    crm(role);
    file(["xiaochuan", "crm", "user-1", "own.png"]);
    expect((await requestPath("xiaochuan", "crm", "user-1", "own.png")).status).toBe(200);
    expect((await requestPath("xiaochuan", "crm", "user-2", "other.png")).status).toBe(403);
    expect((await requestPath("xiaochuan", "agent-account", "agent-1", "other.png")).status).toBe(403);
  });

  it("Agent 本人附件实际可读取", async () => {
    getXiaochuanViewer.mockResolvedValue({ kind: "agent-account", account: { id: "agent-1" } });
    file(["xiaochuan", "agent-account", "agent-1", "own.png"], "own-file");
    const response = await requestPath("xiaochuan", "agent-account", "agent-1", "own.png");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("own-file");
  });

  it.each(["../../../contracts/secret.pdf", "..", ".", "..\\..\\contracts\\secret.pdf", ""])("拒绝危险路径段 %s", async (segment) => {
    getXiaochuanViewer.mockResolvedValue({ kind: "agent-account", account: { id: "agent-1" } });
    file(["contracts", "secret.pdf"]);
    expect((await requestPath("xiaochuan", "agent-account", "agent-1", segment)).status).toBe(400);
  });

  it("拒绝从本人目录通过符号链接读取合同或别人文件", async () => {
    getXiaochuanViewer.mockResolvedValue({ kind: "agent-account", account: { id: "agent-1" } });
    const secret = file(["contracts", "secret.pdf"]);
    const ownDir = path.dirname(file(["xiaochuan", "agent-account", "agent-1", "own.png"]));
    symlinkSync(secret, path.join(ownDir, "link.pdf"));
    expect((await requestPath("xiaochuan", "agent-account", "agent-1", "link.pdf")).status).toBe(404);
  });

  it("合同读取查询必须带区域、业务线及软删条件", async () => {
    crm();
    file(["contracts", "own.pdf"]);
    mocks.contract.mockResolvedValue({ id: "contract-1" });
    expect((await requestPath("contracts", "own.pdf")).status).toBe(200);
    expect(mocks.contract).toHaveBeenCalledWith({
      where: {
        attachmentUrl: { in: ["/uploads/contracts/own.pdf", "/api/uploads/contracts/own.pdf"] }, deletedAt: null,
        customer: { deletedAt: null, businessLine: "国内销售", OR: [{ province: "山东省" }] },
      }, select: { id: true },
    });
    mocks.contract.mockResolvedValue(null);
    expect((await requestPath("contracts", "own.pdf")).status).toBe(403);
  });

  it.each(["contracts", "shipments"])("%s 新附件仅上传者可在保存前预览，保存后不绕过业务权限", async (category) => {
    crm();
    const segments = [category, "crm", "user-1", ...(category === "shipments" ? ["docs"] : []), "new.pdf"];
    file(segments);
    const lookup = category === "contracts" ? mocks.contract : mocks.shipment;
    lookup.mockResolvedValue(null);
    expect((await requestPath(...segments)).status).toBe(200);
    lookup.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "outside-scope" });
    expect((await requestPath(...segments)).status).toBe(403);
    lookup.mockResolvedValue(null);
    segments[2] = "user-2";
    expect((await requestPath(...segments)).status).toBe(403);
  });

  it("ERP 附件复用实体权限，不能凭地址跨负责人读取", async () => {
    crm("PURCHASE");
    file(["erp", "stock_in", "own.pdf"]);
    mocks.erpAttachment.mockResolvedValue({ entityType: "STOCK_IN", entityId: "in-1" });
    mocks.canViewAttachmentEntity.mockResolvedValue(false);
    expect((await requestPath("erp", "stock_in", "own.pdf")).status).toBe(403);
    mocks.canViewAttachmentEntity.mockResolvedValue(true);
    expect((await requestPath("erp", "stock_in", "own.pdf")).status).toBe(200);
  });

  it("CRM 历史扁平附件仅在本人对话记录中存在时可读", async () => {
    crm();
    file(["xiaochuan", "legacy.png"]);
    mocks.agentMessage.mockResolvedValue(null);
    expect((await requestPath("xiaochuan", "legacy.png")).status).toBe(403);
    mocks.agentMessage.mockResolvedValue({ id: "message-1" });
    expect((await requestPath("xiaochuan", "legacy.png")).status).toBe(200);
    expect(mocks.agentMessage).toHaveBeenCalledWith({ where: {
      conversation: { userId: "user-1" }, attachments: { path: "$[*].url", array_contains: ["/uploads/xiaochuan/legacy.png"] },
    }, select: { id: true } });
  });
});
