import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attachmentEntityExists: vi.fn(),
  canAccessERP: vi.fn(),
  canModifyAttachmentEntity: vi.fn(),
  create: vi.fn(),
  findFirst: vi.fn(),
  getSessionUser: vi.fn(),
  getUploadPath: vi.fn(),
  getUploadUrl: vi.fn(),
  mkdir: vi.fn(),
  sanitizeFileName: vi.fn(),
  transaction: vi.fn(),
  writeFile: vi.fn(),
  writeOperationLog: vi.fn(),
}));

vi.mock("fs/promises", () => ({ mkdir: mocks.mkdir, writeFile: mocks.writeFile }));
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    erpAttachment: { create: mocks.create, findFirst: mocks.findFirst },
  },
}));
vi.mock("@/lib/permissions", () => ({ canAccessERP: mocks.canAccessERP, getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/uploads", () => ({
  getUploadPath: mocks.getUploadPath,
  getUploadUrl: mocks.getUploadUrl,
  sanitizeFileName: mocks.sanitizeFileName,
}));
vi.mock("@/lib/erp-attachments", () => ({
  attachmentEntityExists: mocks.attachmentEntityExists,
  canModifyAttachmentEntity: mocks.canModifyAttachmentEntity,
  canViewAttachmentEntity: vi.fn(),
}));
vi.mock("@/lib/sales-items", () => ({ writeOperationLog: mocks.writeOperationLog }));

import { POST } from "./route";

function attachmentUploadRequest(fileName = "到货照片.jpg") {
  const form = new FormData();
  form.set("entityType", "STOCK_IN");
  form.set("entityId", "stock-in-1");
  form.set("file", new File(["photo"], fileName, { type: "image/jpeg" }));
  return new Request("http://localhost/api/erp/attachments", { method: "POST", body: form });
}

describe("POST /api/erp/attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: "admin-1", role: "SUPER_ADMIN" });
    mocks.canAccessERP.mockReturnValue(true);
    mocks.attachmentEntityExists.mockResolvedValue(true);
    mocks.canModifyAttachmentEntity.mockResolvedValue(true);
    mocks.findFirst.mockResolvedValue(null);
    mocks.getUploadPath.mockReturnValue("/uploads/erp/stock_in");
    mocks.getUploadUrl.mockReturnValue("/uploads/erp/stock_in/new-photo.jpg");
    mocks.sanitizeFileName.mockReturnValue("new-photo.jpg");
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.create.mockResolvedValue({ id: "attachment-2" });
    mocks.transaction.mockImplementation(async (callback) => callback({}));
    mocks.writeOperationLog.mockResolvedValue(undefined);
  });

  it("rejects an active attachment with the same name before writing a duplicate", async () => {
    mocks.findFirst.mockResolvedValue({ id: "attachment-1" });

    const response = await POST(attachmentUploadRequest() as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "同一单据已存在同名附件，请先删除原附件后再上传" });
    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
