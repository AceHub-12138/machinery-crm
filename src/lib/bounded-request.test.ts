import { expect, it, vi } from "vitest";
import { readBoundedBody } from "./bounded-request";
it("没有 Content-Length 的超限流也被中止", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4)); controller.enqueue(new Uint8Array(4)); }, cancel });
  const request = new Request("http://localhost", { method: "POST", body, duplex: "half" } as RequestInit);
  await expect(readBoundedBody(request, 5)).rejects.toThrow("大小限制");
  expect(cancel).toHaveBeenCalledTimes(1);
});
it("正常 JSON/multipart 字节保持完整", async () => {
  const request = new Request("http://localhost", { method: "POST", body: "测试123" });
  expect((await readBoundedBody(request, 20)).toString()).toBe("测试123");
});
