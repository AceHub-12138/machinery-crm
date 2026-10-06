import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/permissions", () => ({ getSessionUser: mocks.user, canManageProducts: (user: { role: string }) => user.role === "SUPER_ADMIN" }));
import { PUT } from "./route";
let saved: { model: string; translations: string[] };
let rejectTranslations: boolean;
beforeEach(() => {
  saved = { model: "old", translations: ["旧翻译"] };
  rejectTranslations = false;
  mocks.user.mockResolvedValue({ id: "admin", role: "SUPER_ADMIN" });
  // 模拟事务隔离：只有整段成功才提交，防止更新产品和清空翻译分别提交。
  mocks.transaction.mockImplementation(async (operation) => {
    const pending = structuredClone(saved);
    const result = await operation({
      product: {
        update: async ({ data }: { data: { model: string } }) => { pending.model = data.model; },
        findUnique: async () => pending,
      },
      productTranslation: {
        deleteMany: async () => { pending.translations = []; },
        createMany: async ({ data }: { data: { name: string }[] }) => {
          if (rejectTranslations) throw new Error("translation constraint");
          pending.translations = data.map((row) => row.name);
        },
      },
    });
    saved = pending;
    return result;
  });
});
function update() {
  return PUT(new NextRequest("http://localhost/api/products/p1", {
    method: "PUT", body: JSON.stringify({ model: "new", translations: [{ language: "en", name: "new translation" }] }),
  }), { params: Promise.resolve({ id: "p1" }) });
}
it("产品和翻译同时提交", async () => {
  expect((await update()).status).toBe(200);
  expect(saved).toEqual({ model: "new", translations: ["new translation"] });
});
it("翻译失败时原产品和原翻译都保留", async () => {
  rejectTranslations = true;
  await expect(update()).rejects.toThrow("translation constraint");
  expect(saved).toEqual({ model: "old", translations: ["旧翻译"] });
});
it("未授权用户不能更新产品或开启事务", async () => {
  mocks.transaction.mockClear();
  mocks.user.mockResolvedValue({ role: "SALES" });
  expect((await update()).status).toBe(403);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
