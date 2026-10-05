import { describe, expect, it } from "vitest";
import { DomainError } from "@/modules/shared/domain-error";
import {
  buildSalesScreenShareView,
  generatePublicId,
  normalizeSalesScreenShareState,
  parseSalesScreenShareState,
} from "./share";

const VALID_PUBLIC_ID = "q2Zx7Q01zJ8xa6FW3bVcE3Hn5Rk9sTdY0uLm2OiP4nQ";

describe("share state normalization", () => {
  it("returns safe disabled state for missing or corrupt values and never invents a publicId", () => {
    for (const corrupt of [undefined, null, "string", 42, [], { version: 2 }]) {
      const result = normalizeSalesScreenShareState(corrupt);
      expect(result).toEqual({
        version: 1,
        publicId: null,
        createdAt: null,
        rotatedAt: null,
        revokedAt: null,
      });
    }
  });

  it("returns a fresh object on every call instead of a shared mutable reference", () => {
    const first = normalizeSalesScreenShareState(undefined);
    first.publicId = "tampered";

    const second = normalizeSalesScreenShareState(undefined);
    expect(second.publicId).toBeNull();
  });

  it("preserves a structurally valid active share state and drops unknown fields", () => {
    const active = {
      version: 1,
      publicId: "q2Zx7Q01zJ8xa6FW3bVcE3Hn5Rk9sTdY0uLm2OiP4nQ",
      createdAt: "2026-09-20T08:00:00.000Z",
      rotatedAt: "2026-09-21T09:30:00.000Z",
      revokedAt: null,
      extra: "should be removed",
    };

    const result = normalizeSalesScreenShareState(active);
    expect(result).toEqual({
      version: 1,
      publicId: "q2Zx7Q01zJ8xa6FW3bVcE3Hn5Rk9sTdY0uLm2OiP4nQ",
      createdAt: "2026-09-20T08:00:00.000Z",
      rotatedAt: "2026-09-21T09:30:00.000Z",
      revokedAt: null,
    });
    expect(Object.keys(result)).toEqual(["version", "publicId", "createdAt", "rotatedAt", "revokedAt"]);
  });

  it("preserves the revocation marker of a valid revoked state", () => {
    const revoked = {
      version: 1,
      publicId: null,
      createdAt: "2026-09-20T08:00:00.000Z",
      rotatedAt: null,
      revokedAt: "2026-09-21T10:00:00.000Z",
    };

    expect(normalizeSalesScreenShareState(revoked)).toEqual(revoked);
  });

  it("falls back to the safe disabled state for corrupt publicId, times, version or conflicts", () => {
    const validPublicId = "q2Zx7Q01zJ8xa6FW3bVcE3Hn5Rk9sTdY0uLm2OiP4nQ";
    const corruptCases: Array<[string, unknown]> = [
      ["publicId wrong charset", { version: 1, publicId: "!!!!非法字符!!!!not-base64url!!", createdAt: null, rotatedAt: null, revokedAt: null }],
      ["publicId wrong length", { version: 1, publicId: "too-short", createdAt: null, rotatedAt: null, revokedAt: null }],
      ["publicId wrong type", { version: 1, publicId: 12345, createdAt: null, rotatedAt: null, revokedAt: null }],
      ["invalid createdAt", { version: 1, publicId: validPublicId, createdAt: "not-a-date", rotatedAt: null, revokedAt: null }],
      ["invalid revokedAt type", { version: 1, publicId: null, createdAt: null, rotatedAt: null, revokedAt: 123 }],
      ["wrong version", { version: 2, publicId: validPublicId, createdAt: null, rotatedAt: null, revokedAt: null }],
      ["active link with revocation marker", { version: 1, publicId: validPublicId, createdAt: null, rotatedAt: null, revokedAt: "2026-09-21T10:00:00.000Z" }],
      // 日历溢出：JS 会把 2026-02-30 归一为 03-02、25 点归一为次日 1 点，必须整体回退安全态
      ["calendar-overflow day", { version: 1, publicId: validPublicId, createdAt: "2026-02-30T00:00:00.000Z", rotatedAt: null, revokedAt: null }],
      ["calendar-overflow hour", { version: 1, publicId: validPublicId, createdAt: "2026-09-21T25:00:00.000Z", rotatedAt: null, revokedAt: null }],
    ];

    for (const [reason, corrupt] of corruptCases) {
      // reason 仅用于定位失败用例
      const result = normalizeSalesScreenShareState(corrupt);
      try {
        expect(result).toEqual({ version: 1, publicId: null, createdAt: null, rotatedAt: null, revokedAt: null });
      } catch (error) {
        throw new Error(`归一化损坏数据未回退安全态：${reason}`, { cause: error });
      }
    }
  });
});

describe("share state strict parsing", () => {
  const validActive = {
    version: 1 as const,
    publicId: VALID_PUBLIC_ID,
    createdAt: "2026-09-20T08:00:00.000Z",
    rotatedAt: "2026-09-21T09:30:00.000Z",
    revokedAt: null,
  };

  it("accepts a complete valid state unchanged", () => {
    expect(parseSalesScreenShareState(validActive)).toEqual(validActive);
    expect(parseSalesScreenShareState({ version: 1, publicId: null, createdAt: null, rotatedAt: null, revokedAt: null })).toEqual({
      version: 1,
      publicId: null,
      createdAt: null,
      rotatedAt: null,
      revokedAt: null,
    });
  });

  it("rejects non-object input with a Chinese DomainError", () => {
    for (const bad of [undefined, null, "object", 7, []]) {
      try {
        parseSalesScreenShareState(bad);
        expect.unreachable(`expected rejection for ${JSON.stringify(bad)}`);
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).message).toBe("共享状态必须是对象");
        expect((error as DomainError).status).toBe(400);
      }
    }
  });

  it("rejects unknown fields at the top level", () => {
    expect(() => parseSalesScreenShareState({ ...validActive, hackerField: true })).toThrow("共享状态包含未知字段");
  });

  it("rejects wrong version", () => {
    expect(() => parseSalesScreenShareState({ ...validActive, version: 2 })).toThrow("共享状态版本不受支持");
  });

  it("rejects wrong field types", () => {
    expect(() => parseSalesScreenShareState({ ...validActive, publicId: 42 })).toThrow("字段 publicId 的类型不正确");
    expect(() => parseSalesScreenShareState({ ...validActive, rotatedAt: 123 })).toThrow("字段 rotatedAt 的类型不正确");
    expect(() => parseSalesScreenShareState({ ...validActive, createdAt: false })).toThrow("字段 createdAt 的类型不正确");
  });

  it("rejects invalid time strings", () => {
    expect(() => parseSalesScreenShareState({ ...validActive, createdAt: "2026-09-20 08:00:00" })).toThrow("字段 createdAt 的时间格式无效");
    expect(() => parseSalesScreenShareState({ ...validActive, createdAt: "not-a-date" })).toThrow("字段 createdAt 的时间格式无效");
    expect(() => parseSalesScreenShareState({ ...validActive, revokedAt: "2026-13-40T99:00:00.000Z" })).toThrow("字段 revokedAt 的时间格式无效");
  });

  it("rejects calendar-overflow dates that JavaScript would silently normalize", () => {
    // 2026-02-30 会被 Date.parse 归一为 2026-03-02，必须按非法时间拒绝
    expect(() => parseSalesScreenShareState({ ...validActive, createdAt: "2026-02-30T00:00:00.000Z" })).toThrow("字段 createdAt 的时间格式无效");
    // 2024 为闰年，2023-02-29 溢出同样必须拒绝
    expect(() => parseSalesScreenShareState({ ...validActive, createdAt: "2023-02-29T12:00:00.000Z" })).toThrow("字段 createdAt 的时间格式无效");
    // 小时溢出（25 点归一为次日 1 点）也必须拒绝
    expect(() => parseSalesScreenShareState({ ...validActive, rotatedAt: "2026-09-21T25:00:00.000Z" })).toThrow("字段 rotatedAt 的时间格式无效");
  });

  it("rejects malformed publicId values", () => {
    expect(() => parseSalesScreenShareState({ ...validActive, publicId: "short" })).toThrow("字段 publicId 的格式无效");
    expect(() => parseSalesScreenShareState({ ...validActive, publicId: "!".repeat(43) })).toThrow("字段 publicId 的格式无效");
    expect(() => parseSalesScreenShareState({ ...validActive, publicId: VALID_PUBLIC_ID + "x" })).toThrow("字段 publicId 的格式无效");
  });
});

describe("publicId generation", () => {
  it("generates 43-character base64url identifiers from the allowed charset", () => {
    for (let i = 0; i < 50; i += 1) {
      const id = generatePublicId();
      expect(id).toHaveLength(43);
      expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it("never repeats identifiers across samples, so links stay unguessable", () => {
    const samples = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      samples.add(generatePublicId());
    }
    expect(samples.size).toBe(200);
  });
});

describe("share view", () => {
  it("builds a relative kiosk path for an active link", () => {
    const view = buildSalesScreenShareView({
      version: 1,
      publicId: VALID_PUBLIC_ID,
      createdAt: "2026-09-20T08:00:00.000Z",
      rotatedAt: null,
      revokedAt: null,
    });
    expect(view).toEqual({
      share: {
        version: 1,
        publicId: VALID_PUBLIC_ID,
        createdAt: "2026-09-20T08:00:00.000Z",
        rotatedAt: null,
        revokedAt: null,
      },
      path: `/screen/sales/${VALID_PUBLIC_ID}?kiosk=1`,
    });
  });

  it("returns a null path when there is no active publicId", () => {
    const view = buildSalesScreenShareView({ version: 1, publicId: null, createdAt: null, rotatedAt: null, revokedAt: null });
    expect(view.path).toBeNull();
  });
});
