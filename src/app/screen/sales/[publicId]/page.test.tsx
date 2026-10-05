import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DomainError } from "@/modules/shared/domain-error";
import {
  buildPublicSalesScreenPayloadFixture,
  FIXTURE_PUBLIC_ID,
} from "@/modules/screen/sales-screen-payload.fixture";

vi.mock("@/modules/screen/public-service", () => ({
  getPublicSalesScreenPayload: vi.fn(),
}));

const { getPublicSalesScreenPayload } = await import("@/modules/screen/public-service");
const SalesScreenPage = (await import("@/app/screen/sales/[publicId]/page")).default;
const pageModule = await import("@/app/screen/sales/[publicId]/page");

async function renderPage(searchParams: Record<string, string | string[]> = {}) {
  const element = await SalesScreenPage({
    params: Promise.resolve({ publicId: FIXTURE_PUBLIC_ID }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(element);
}

describe("public sales screen page (Server Component)", () => {
  beforeEach(() => {
    vi.mocked(getPublicSalesScreenPayload).mockReset();
  });

  it("is registered as a dynamic, never-cached route with noindex metadata", () => {
    expect(pageModule.dynamic).toBe("force-dynamic");
    expect(pageModule.revalidate).toBe(0);
    expect(pageModule.metadata.robots).toEqual({ index: false, follow: false });
  });

  it("serves real business content in the first HTML screen — no loading shell", () => {
    vi.mocked(getPublicSalesScreenPayload).mockResolvedValue(
      buildPublicSalesScreenPayloadFixture(),
    );
    return renderPage().then((html) => {
      // 首屏直接包含经营数据与面板，而不是黑屏/loading 后再 fetch
      expect(html).toContain("经营指挥舱");
      expect(html).toContain("经营指标");
      expect(html).toContain("¥5,164.0万");
      expect(html).toContain("全国交付态势");
      expect(html).toContain("合同与回款");
      expect(html).toContain("交付里程碑");
      expect(html).not.toMatch(/loading|加载中/i);
    });
  });

  it("fetches the payload through the service with the publicId from the route params", async () => {
    vi.mocked(getPublicSalesScreenPayload).mockResolvedValue(
      buildPublicSalesScreenPayloadFixture(),
    );
    await renderPage();
    expect(getPublicSalesScreenPayload).toHaveBeenCalledWith(FIXTURE_PUBLIC_ID);
  });

  it("shows a generic unavailable screen for invalid, revoked or closed links", async () => {
    vi.mocked(getPublicSalesScreenPayload).mockRejectedValue(
      new DomainError("大屏不可用", 404),
    );
    const html = await renderPage();
    expect(html).toContain("大屏不可用");
    // 不跳转登录页，不输出失败原因差异或内部细节
    expect(html).not.toMatch(/login|登录|signin/i);
    expect(html).not.toContain("大屏暂时不可用");
    expect(html).not.toContain("publicId");
  });

  it("shows a generic temporary-unavailable screen for unknown errors without leaking internals", async () => {
    vi.mocked(getPublicSalesScreenPayload).mockRejectedValue(
      new Error("PrismaClientKnownRequestError: connection refused at /opt/db/main"),
    );
    const html = await renderPage();
    expect(html).toContain("大屏暂时不可用");
    expect(html).not.toContain("Prisma");
    expect(html).not.toContain("/opt/db");
    expect(html).not.toContain("stack");
  });

  it("renders exactly the modules enabled in the payload", async () => {
    vi.mocked(getPublicSalesScreenPayload).mockResolvedValue(
      buildPublicSalesScreenPayloadFixture({
        modules: {
          operatingKpis: true,
          deliveryMap: false,
          collection: false,
          deliveryAlerts: true,
          deliveryMilestones: false,
        },
      }),
    );
    const html = await renderPage();
    expect(html).toContain("经营指标");
    expect(html).toContain("交付预警");
    expect(html).not.toContain("全国交付态势");
    expect(html).not.toContain("合同与回款");
    expect(html).not.toContain("交付里程碑");
  });

  it("passes kiosk mode from the URL onto the screen root only", async () => {
    vi.mocked(getPublicSalesScreenPayload).mockResolvedValue(
      buildPublicSalesScreenPayloadFixture(),
    );
    const kioskHtml = await renderPage({ kiosk: "1" });
    expect(kioskHtml).toContain('data-kiosk="1"');

    const normalHtml = await renderPage({ fit: "0" });
    expect(normalHtml).not.toContain("data-kiosk");
  });
});
