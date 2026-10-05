import { NextRequest } from "next/server";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { user } = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ getSessionUser: user }));
import { POST as contractUpload } from "./route";
import { POST as shipmentUpload } from "../shipments/route";
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "dachuan-upload-")); vi.stubEnv("UPLOAD_DIR", root); user.mockResolvedValue({ id: "sales-1", role: "SALES" }); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
function request(file?: File) {
  const data = new FormData();
  if (file) data.set("file", file);
  return new NextRequest("http://localhost/api/upload/contracts", { method: "POST", body: data });
}
it.each([["contracts", contractUpload], ["shipments", shipmentUpload]] as const)("%s 新附件存放到上传者目录并保留原内容", async (category, upload) => {
  const response = await upload(request(new File(["%PDF-1.4"], "合同.pdf")));
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.url).toMatch(new RegExp(`^/uploads/${category}/crm/sales-1/`));
  const segments = data.url.slice("/uploads/".length).split("/").map(decodeURIComponent);
  expect((await readFile(path.join(root, ...segments))).toString()).toBe("%PDF-1.4");
});
it("超过 20MB 的合同文件被拒绝，避免回归到 100MB", async () => {
  const response = await contractUpload(request(new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.pdf")));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain("20MB");
});
it("仓库角色不能上传合同或发货附件", async () => {
  user.mockResolvedValue({ id: "warehouse-1", role: "WAREHOUSE" });
  expect((await contractUpload(request())).status).toBe(403);
  expect((await shipmentUpload(request())).status).toBe(403);
});
