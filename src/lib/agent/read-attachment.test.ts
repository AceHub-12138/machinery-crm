import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readXiaochuanAttachment } from "./read-attachment";
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "dachuan-parser-")); vi.stubEnv("UPLOAD_DIR", root); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
it("CAD/视觉解析器都能读取账号分目录附件及历史文件", async () => {
  for (const segments of [["crm", "u1", "drawing.dxf"], ["agent-account", "a1", "photo.png"], ["legacy.pdf"]]) {
    const file = path.join(root, "xiaochuan", ...segments);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "attachment");
    expect((await readXiaochuanAttachment(`/uploads/xiaochuan/${segments.join("/")}`))?.toString()).toBe("attachment");
  }
});
it("拒绝编码的路径穿越以及同根目录中的跨账号符号链接", async () => {
  await mkdir(path.join(root, "xiaochuan", "crm", "u1"), { recursive: true });
  await mkdir(path.join(root, "xiaochuan", "crm", "u2"), { recursive: true });
  const secret = path.join(root, "xiaochuan", "crm", "u2", "secret.pdf");
  await writeFile(secret, "secret");
  await symlink(secret, path.join(root, "xiaochuan", "crm", "u1", "link.pdf"));
  expect(await readXiaochuanAttachment("/uploads/xiaochuan/crm/u1/link.pdf")).toBeNull();
  expect(await readXiaochuanAttachment("/uploads/xiaochuan/crm/u1/%2e%2e%2fu2%2fsecret.pdf")).toBeNull();
});
