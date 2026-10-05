/** 在解析 JSON / multipart 前限制实际读取字节，不能仅信任 Content-Length。 */
export async function readBoundedBody(request: Request, maxBytes: number) {
  if (Number(request.headers.get("content-length") || 0) > maxBytes) throw new Error("请求超过大小限制");
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error("请求超过大小限制");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, length);
  } finally {
    reader.releaseLock();
  }
}
