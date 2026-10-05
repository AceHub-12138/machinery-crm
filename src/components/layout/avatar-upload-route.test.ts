import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  mkdir: vi.fn(),
  transaction: vi.fn(),
  unlink: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  writeFile: vi.fn(),
  writeOperationLog: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    user: { findUnique: mocks.userFindUnique },
  },
}));

vi.mock("@/lib/sales-items", () => ({
  writeOperationLog: mocks.writeOperationLog,
}));

vi.mock("fs/promises", () => ({
  mkdir: mocks.mkdir,
  unlink: mocks.unlink,
  writeFile: mocks.writeFile,
}));

import { GET, POST } from "@/app/api/upload/avatar/route";

function avatarRequest(
  userId: string,
  fileName = "avatar.png",
  type = "image/png",
  size = 6,
) {
  const formData = new FormData();
  formData.set("userId", userId);
  formData.set("file", new Blob([new Uint8Array(size)], { type }), fileName);
  return new NextRequest("http://localhost/api/upload/avatar", {
    body: formData,
    method: "POST",
  });
}

describe("POST /api/upload/avatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: "user-a" });
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.unlink.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.writeOperationLog.mockResolvedValue(undefined);
    mocks.userFindUnique.mockResolvedValue({
      avatarPath: "/uploads/avatars/old-avatar.png",
    });
    mocks.userUpdate.mockImplementation(async ({ data }) => ({
      avatarPath: data.avatarPath,
      id: "user-a",
    }));
    mocks.transaction.mockImplementation(async (callback) =>
      callback({ user: { update: mocks.userUpdate } }),
    );
  });

  it("requires an authenticated user", async () => {
    mocks.getSessionUser.mockResolvedValueOnce(null);

    const response = await POST(avatarRequest("user-a"));

    expect(response.status).toBe(401);
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("rejects attempts to update another user's avatar", async () => {
    const response = await POST(avatarRequest("user-b"));

    expect(response.status).toBe(403);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("requires both an allowed extension and its matching image MIME type", async () => {
    const wrongMime = await POST(
      avatarRequest("user-a", "avatar.png", "application/octet-stream"),
    );
    const wrongExtension = await POST(
      avatarRequest("user-a", "avatar.gif", "image/gif"),
    );

    expect(wrongMime.status).toBe(400);
    expect(wrongExtension.status).toBe(400);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("rejects avatar files larger than 2 MB", async () => {
    const response = await POST(
      avatarRequest("user-a", "avatar.webp", "image/webp", 2 * 1024 * 1024 + 1),
    );

    expect(response.status).toBe(400);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("stores the avatar in the shared upload root and updates only the signed-in user", async () => {
    const response = await POST(
      avatarRequest("user-a", "my avatar.webp", "image/webp"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.avatarPath).toMatch(/^\/api\/uploads\/avatars\//);
    expect(mocks.mkdir).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]avatars$/),
      { recursive: true },
    );
    expect(mocks.writeFile).toHaveBeenCalledOnce();
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]avatars[\\/].+\.webp$/),
      expect.any(Buffer),
      { flag: "wx" },
    );
    expect(mocks.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { avatarPath: expect.stringMatching(/^\/uploads\/avatars\//) },
        where: { id: "user-a" },
      }),
    );
    expect(mocks.writeOperationLog).toHaveBeenCalledOnce();
    expect(mocks.unlink).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]avatars[\\/]old-avatar\.png$/),
    );
  });

  it("does not fail a successful update when the old avatar cannot be deleted", async () => {
    mocks.unlink.mockRejectedValueOnce(new Error("file is locked"));

    const response = await POST(avatarRequest("user-a"));

    expect(response.status).toBe(200);
    expect(mocks.userUpdate).toHaveBeenCalledOnce();
  });

  it("removes the new file when the database transaction fails", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await POST(avatarRequest("user-a"));

    expect(response.status).toBe(500);
    expect(mocks.writeFile).toHaveBeenCalledOnce();
    expect(mocks.unlink).toHaveBeenCalledWith(
      expect.not.stringMatching(/old-avatar\.png$/),
    );
  });

  it("never deletes an existing file when exclusive creation reports a collision", async () => {
    mocks.writeFile.mockRejectedValueOnce(
      Object.assign(new Error("file exists"), { code: "EEXIST" }),
    );

    const response = await POST(avatarRequest("user-a"));

    expect(response.status).toBe(500);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.unlink).not.toHaveBeenCalled();
  });
});

describe("GET /api/upload/avatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: "user-a" });
    mocks.userFindUnique.mockResolvedValue({
      avatarPath: "/uploads/avatars/current.png",
    });
  });

  it("returns the signed-in user's protected avatar URL", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      avatarPath: "/api/uploads/avatars/current.png",
    });
    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      select: { avatarPath: true },
      where: { id: "user-a" },
    });
  });
});
