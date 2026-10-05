import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ viewer: vi.fn(), config: vi.fn(), legacy: vi.fn(), create: vi.fn(), analyze: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/agent/auth", () => ({ getXiaochuanViewer: mocks.viewer, agentAccountToMcpUser: vi.fn() }));
vi.mock("@/lib/agent/model-config-store", () => ({ resolveXiaochuanRuntimeConfig: mocks.config }));
vi.mock("@/lib/db", () => ({ prisma: { agentMessage: { findFirst: mocks.legacy, create: mocks.create } } }));
vi.mock("@/lib/agent/vision", () => ({ analyzeAttachmentsForTurn: mocks.analyze }));
vi.mock("@/lib/agent/rate-limit", () => ({ checkXiaochuanRateLimit: mocks.rate }));
import { POST } from "./route";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.viewer.mockResolvedValue({ kind: "crm", user: { id: "user-1", role: "SALES" } });
  mocks.config.mockResolvedValue({ maxRequestBytes: 30_000, rateLimitPerMinute: 10 });
  mocks.rate.mockReturnValue({ allowed: false, retryAfterSeconds: 1 });
});
function request() {
  return new Request("http://localhost/api/agent/chat", { method: "POST", body: JSON.stringify({ message: "请读取这张图纸", attachments: [{ url: "/uploads/xiaochuan/legacy.png", name: "图纸.png", type: "image/png", size: 20, kind: "image" }] }) });
}
it("不能通过新提问冒领他人的历史附件；不落库，不触发视觉解析", async () => {
  mocks.legacy.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(403);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.analyze).not.toHaveBeenCalled();
  expect(mocks.rate).not.toHaveBeenCalled();
});
it("本人历史附件可通过归属校验，进入后续限流流程", async () => {
  mocks.legacy.mockResolvedValue({ id: "owned-message" });
  expect((await POST(request())).status).toBe(429);
  expect(mocks.legacy).toHaveBeenCalledWith({ where: { conversation: { userId: "user-1" }, attachments: { path: "$[*].url", array_contains: ["/uploads/xiaochuan/legacy.png"] } }, select: { id: true } });
});
