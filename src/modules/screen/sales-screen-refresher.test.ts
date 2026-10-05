import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSalesScreenRefresher,
  SALES_SCREEN_REFRESH_INTERVAL_MS,
} from "./sales-screen-refresher";
import {
  buildPublicSalesScreenPayloadFixture,
  FIXTURE_PUBLIC_ID,
} from "./sales-screen-payload.fixture";

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function errorResponse(status: number) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ error: "大屏不可用" }),
  } as unknown as Response;
}

describe("sales screen refresher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls the public API every 60 seconds with a relative, encoded path and no-store", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(buildPublicSalesScreenPayloadFixture()));
    const onPayload = vi.fn();
    const refresher = createSalesScreenRefresher({
      publicId: FIXTURE_PUBLIC_ID,
      initialPayload: buildPublicSalesScreenPayloadFixture(),
      onPayload,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(SALES_SCREEN_REFRESH_INTERVAL_MS).toBe(60_000);
    refresher.start();

    await vi.advanceTimersByTimeAsync(SALES_SCREEN_REFRESH_INTERVAL_MS - 1);
    expect(fetchImpl).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/screen/sales/${encodeURIComponent(FIXTURE_PUBLIC_ID)}`);
    expect((init as RequestInit).cache).toBe("no-store");

    await vi.advanceTimersByTimeAsync(SALES_SCREEN_REFRESH_INTERVAL_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    refresher.stop();
  });

  it("replaces the payload after a successful poll", async () => {
    const next = buildPublicSalesScreenPayloadFixture({
      generatedAt: "2026-09-21T08:01:00.000Z",
    });
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(next));
    const onPayload = vi.fn();
    const refresher = createSalesScreenRefresher({
      publicId: FIXTURE_PUBLIC_ID,
      initialPayload: buildPublicSalesScreenPayloadFixture(),
      onPayload,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    refresher.start();
    await vi.advanceTimersByTimeAsync(SALES_SCREEN_REFRESH_INTERVAL_MS);

    expect(onPayload).toHaveBeenCalledTimes(1);
    expect(onPayload).toHaveBeenCalledWith(next);
    expect(refresher.getPayload()).toBe(next);

    refresher.stop();
  });

  it("keeps the last good payload on 404, 500, network and JSON failures", async () => {
    const lastGood = buildPublicSalesScreenPayloadFixture();
    const onPayload = vi.fn();
    const failures: Array<() => Promise<Response>> = [
      async () => errorResponse(404),
      async () => errorResponse(500),
      async () => {
        throw new TypeError("Failed to fetch");
      },
      async () => okResponse("{not json" as unknown as object),
      // 非 v1 形状按错误数据处理
      async () => okResponse({ version: 2, note: "unexpected" }),
    ];
    const fetchImpl = vi.fn<() => Promise<Response>>();
    const refresher = createSalesScreenRefresher({
      publicId: FIXTURE_PUBLIC_ID,
      initialPayload: lastGood,
      onPayload,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    // 依次套用每一类失败
    let call = 0;
    (fetchImpl as ReturnType<typeof vi.fn>).mockImplementation(
      () => (failures[Math.min(call, failures.length - 1)] as () => Promise<Response>)(),
    );
    const advance = async () => {
      call += 1;
      await vi.advanceTimersByTimeAsync(SALES_SCREEN_REFRESH_INTERVAL_MS);
    };

    refresher.start();
    await advance();
    await advance();
    await advance();
    await advance();
    await advance();

    expect(onPayload).not.toHaveBeenCalled();
    expect(refresher.getPayload()).toBe(lastGood);

    // 失败之后下一次成功仍然能恢复刷新
    (fetchImpl as ReturnType<typeof vi.fn>).mockImplementation(() =>
      okResponse(buildPublicSalesScreenPayloadFixture({ generatedAt: "2026-09-21T08:09:00.000Z" })),
    );
    await advance();
    expect(onPayload).toHaveBeenCalledTimes(1);

    refresher.stop();
  });

  it("never falls back to mock data — it re-serves the previous real snapshot", async () => {
    const lastGood = buildPublicSalesScreenPayloadFixture({ generatedAt: "2026-09-21T08:00:00.000Z" });
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("offline"));
    const refresher = createSalesScreenRefresher({
      publicId: FIXTURE_PUBLIC_ID,
      initialPayload: lastGood,
      onPayload: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    refresher.start();
    await vi.advanceTimersByTimeAsync(SALES_SCREEN_REFRESH_INTERVAL_MS * 3);
    // 三连败后仍是同一份最后正确数据，且时间戳不是新生成的假数据
    expect(refresher.getPayload()).toBe(lastGood);
    refresher.stop();
  });

  it("does not stack a new request while the previous one is still in flight", async () => {
    let releaseFetch!: (value: Response) => void;
    const fetchImpl = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          releaseFetch = resolve;
        }),
    );
    const refresher = createSalesScreenRefresher({
      publicId: FIXTURE_PUBLIC_ID,
      initialPayload: buildPublicSalesScreenPayloadFixture(),
      onPayload: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    refresher.start();
    await vi.advanceTimersByTimeAsync(SALES_SCREEN_REFRESH_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(SALES_SCREEN_REFRESH_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(SALES_SCREEN_REFRESH_INTERVAL_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    releaseFetch(okResponse(buildPublicSalesScreenPayloadFixture()));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // 释放后的下一轮恢复轮询
    await vi.advanceTimersByTimeAsync(SALES_SCREEN_REFRESH_INTERVAL_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    refresher.stop();
  });

  it("cleans up the timer and aborts in-flight work on stop", async () => {
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            signals.push(signal);
            signal.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }
        }),
    );
    const onPayload = vi.fn();
    const refresher = createSalesScreenRefresher({
      publicId: FIXTURE_PUBLIC_ID,
      initialPayload: buildPublicSalesScreenPayloadFixture(),
      onPayload,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    refresher.start();
    await vi.advanceTimersByTimeAsync(SALES_SCREEN_REFRESH_INTERVAL_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    refresher.stop();
    // 计时器已清理：时间前进不再发请求
    await vi.advanceTimersByTimeAsync(SALES_SCREEN_REFRESH_INTERVAL_MS * 5);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // 未完成的请求已被中止
    expect(signals[0]?.aborted).toBe(true);
    expect(onPayload).not.toHaveBeenCalled();
  });
});
