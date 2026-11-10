export type LookupProgress = { id: string; message: string; status: number };
export async function runContactLookups(ids: string[], progress: (value: LookupProgress, index: number, total: number) => void, request: typeof fetch = fetch) {
  if (!ids.length || ids.length > 20) throw new Error("每次请选择 1~20 条待反查线索");
  for (let index = 0; index < ids.length; index++) {
    const response = await request("/api/crm/leads/" + encodeURIComponent(ids[index]) + "/contact-lookup", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const data = await response.json().catch(() => ({}));
    progress({ id: ids[index], message: response.status === 503 ? "天眼查未配置，已停止批量反查" : data.error || data.reason || data.status || "反查完成", status: response.status }, index + 1, ids.length);
    if ([401, 403, 429, 503].includes(response.status)) break;
  }
}
