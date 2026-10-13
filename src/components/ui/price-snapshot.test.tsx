import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PriceSnapshot } from "./price-snapshot";

describe("historical price snapshot display", () => {
  it("shows the amount without a guessed currency and keeps the status as a separate inline label", () => {
    const html = renderToStaticMarkup(<PriceSnapshot value="100000.50" />);
    expect(html).toContain("100,000.5</span>");
    expect(html).toContain("data-currency-status");
    expect(html).toContain("币种待确认</span>");
    expect(html).not.toMatch(/[¥€$]/);
    expect(html).not.toContain("（币种待确认）");
  });
  it("does not mark a missing amount as an existing snapshot", () => {
    const html = renderToStaticMarkup(<PriceSnapshot value={null} />);
    expect(html).toContain(">-</span>");
    expect(html).not.toContain("币种待确认");
  });
  it("still shows the status for a real zero amount", () => {
    const html = renderToStaticMarkup(<PriceSnapshot value={0} />);
    expect(html).toContain(">0</span>");
    expect(html).toContain("币种待确认");
  });
});
