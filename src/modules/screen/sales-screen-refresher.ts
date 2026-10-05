/**
 * 展厅大屏客户端刷新器（框架无关）。
 *
 * 每 60 秒请求相对路径的公开 API；任何失败（404/500/网络/JSON/形状不符）
 * 都保留最后一份正确数据，绝不回退到 mock。上一轮未完成时不叠加下一轮；
 * stop 时清理计时器并中止未完成请求。React 侧只包一层 effect。
 */

import type { PublicSalesScreenPayload } from "./public-types";

export const SALES_SCREEN_REFRESH_INTERVAL_MS = 60_000;

export type SalesScreenRefresherOptions = {
  publicId: string;
  initialPayload: PublicSalesScreenPayload;
  onPayload: (payload: PublicSalesScreenPayload) => void;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
};

export type SalesScreenRefresher = {
  start: () => void;
  stop: () => void;
  /** 立即拉取一次（测试与手动刷新用） */
  refresh: () => Promise<void>;
  getPayload: () => PublicSalesScreenPayload;
};

function isPublicPayload(value: unknown): value is PublicSalesScreenPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === 1
  );
}

export function createSalesScreenRefresher(options: SalesScreenRefresherOptions): SalesScreenRefresher {
  const intervalMs = options.intervalMs ?? SALES_SCREEN_REFRESH_INTERVAL_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  let payload = options.initialPayload;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: AbortController | null = null;

  const load = async () => {
    // 上一轮未完成时不叠加下一轮
    if (inFlight !== null) return;
    const controller = new AbortController();
    inFlight = controller;
    try {
      const response = await fetchImpl(
        `/api/screen/sales/${encodeURIComponent(options.publicId)}`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!response.ok) return; // 404/500：保留最后一份正确数据
      const next: unknown = await response.json();
      if (!isPublicPayload(next)) return; // 形状不符：同样保留
      payload = next;
      options.onPayload(next);
    } catch {
      // 网络错误 / JSON 解析错误 / 中止：静默保留上一份数据
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  };

  return {
    start() {
      if (timer === null) {
        timer = setInterval(() => void load(), intervalMs);
      }
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (inFlight !== null) {
        inFlight.abort();
        inFlight = null;
      }
    },
    refresh: load,
    getPayload: () => payload,
  };
}
