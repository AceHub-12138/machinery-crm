import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptApiKey, apiKeyHint, decryptApiKey } from "@/lib/agent/model-config-store";

describe("API Key 加密存储", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-for-vitest";
  });
  afterEach(() => {
    delete process.env.AUTH_SECRET;
  });

  it("加密后可解密还原，密文不含明文", () => {
    const plain = "sk-test-abcdef123456";
    const cipher = encryptApiKey(plain);
    expect(cipher).not.toContain(plain);
    expect(decryptApiKey(cipher)).toBe(plain);
  });

  it("同样明文每次加密产生不同密文（随机 IV）", () => {
    const cipher1 = encryptApiKey("same-key");
    const cipher2 = encryptApiKey("same-key");
    expect(cipher1).not.toBe(cipher2);
    expect(decryptApiKey(cipher1)).toBe("same-key");
    expect(decryptApiKey(cipher2)).toBe("same-key");
  });

  it("密文被篡改或格式错误时解密失败返回 null（不抛错）", () => {
    expect(decryptApiKey("not-a-cipher")).toBeNull();
    const cipher = encryptApiKey("another-key");
    const tampered = `${cipher.slice(0, -4)}AAAA`;
    expect(decryptApiKey(tampered)).toBeNull();
  });

  it("hint 只暴露尾四位", () => {
    expect(apiKeyHint("sk-1234567890abcd")).toBe("****abcd");
    expect(apiKeyHint("abcd")).toBe("****abcd");
  });
});
