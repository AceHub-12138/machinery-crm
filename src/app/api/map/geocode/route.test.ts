import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({ getSessionUser: mocks.getSessionUser }));

import { POST } from "./route";

const admin = { id: "admin", role: "SUPER_ADMIN", region: "", territories: [], viewScope: "ALL" };

function tiandituOk() {
  return {
    ok: true,
    json: async () => ({ status: "0", location: { lon: "117.16", lat: "34.81" } }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TIANDITU_KEY = "tk_test_secret";
  mocks.getSessionUser.mockResolvedValue(admin);
});

afterEach(() => {
  delete process.env.TIANDITU_KEY;
});

describe("map geocode response", () => {
  it("never includes the tianditu mapKey in the response payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(tiandituOk());
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("http://localhost/api/map/geocode", {
      method: "POST",
      body: JSON.stringify({ destinations: [{ id: "d-1", address: "山东省济南市某路" }] }),
    });
    const response = await POST(request as never);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect("mapKey" in body).toBe(false);
    expect(JSON.stringify(body)).not.toContain("tk_test_secret");
  });

  it("keeps destinations resolution working and masks key-bearing failure messages", async () => {
    // 使用未被前置测试写入内存缓存的地址，确保真正走到 fetch 失败路径
    const fetchMock = vi.fn().mockRejectedValue(
      new Error(`request failed: https://api.tianditu.gov.cn/geocoder?ds=xx&tk=tk_test_secret`)
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("http://localhost/api/map/geocode", {
      method: "POST",
      body: JSON.stringify({ destinations: [{ id: "d-2", address: "山东省聊城市未缓存路2号" }] }),
    });
    const response = await POST(request as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect("mapKey" in body).toBe(false);
    // 失败原因必须是固定通用消息，不透传任何底层细节
    expect(JSON.stringify(body)).not.toContain("tk_test_secret");
    expect(JSON.stringify(body)).not.toContain("tianditu.gov.cn");
    expect(JSON.stringify(body)).not.toContain("request failed");
  });
});
