import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteAfterSalesErpAttachment, deleteErpAttachment, ErpAttachmentList, uploadErpAttachments } from "./erp-attachments";

describe("uploadErpAttachments", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports a network failure without aborting the remaining uploads", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const failed = await uploadErpAttachments("STOCK_IN", "stock-in-1", [
      new File(["first"], "到货照片.jpg", { type: "image/jpeg" }),
      new File(["second"], "送货单.pdf", { type: "application/pdf" }),
    ]);

    expect(failed).toEqual(["到货照片.jpg"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("ErpAttachmentList", () => {
  it("renders each stored ERP attachment through the protected upload endpoint", () => {
    const markup = renderToStaticMarkup(createElement(ErpAttachmentList, {
      attachments: [{
        id: "attachment-1",
        fileName: "到货照片.jpg",
        fileUrl: "/uploads/erp/stock_in/arrival.jpg",
      }],
    }));

    expect(markup).toContain('href="/api/uploads/erp/stock_in/arrival.jpg"');
  });

  it("renders a delete control when removal is enabled for an attachment", () => {
    const markup = renderToStaticMarkup(createElement(ErpAttachmentList, {
      attachments: [{
        id: "attachment-1",
        fileName: "到货照片.jpg",
        fileUrl: "/uploads/erp/stock_in/arrival.jpg",
      }],
      deletingId: null,
      onDelete: () => undefined,
    }));

    expect(markup).toContain('aria-label="删除附件：到货照片.jpg"');
  });
});

describe("deleteErpAttachment", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests the existing soft-delete endpoint for the selected attachment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteErpAttachment("attachment-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/erp/attachments/attachment-1", { method: "DELETE" });
  });
});

describe("deleteAfterSalesErpAttachment", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests the after-sales-only delete endpoint for the selected attachment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteAfterSalesErpAttachment("attachment-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/erp/attachments?id=attachment-1", { method: "DELETE" });
  });
});
