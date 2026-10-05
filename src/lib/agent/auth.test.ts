import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isAgentAccountTokenCurrent,
  signAgentAccountToken,
  verifyAgentAccountToken,
} from "@/lib/agent/account-token";

describe("Agent 独立账号登录态 Token", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-for-vitest";
  });
  afterEach(() => {
    delete process.env.AUTH_SECRET;
  });

  it("签发后可验证，payload 带账号身份", async () => {
    const token = await signAgentAccountToken({ id: "acc-1", username: "user01", displayName: "张三", sessionVersion: 2 });
    const payload = await verifyAgentAccountToken(token);
    expect(payload).toMatchObject({ sub: "acc-1", username: "user01", displayName: "张三", sessionVersion: 2 });
  });

  it("篡改的 Token 验证失败返回 null", async () => {
    const token = await signAgentAccountToken({ id: "acc-1", username: "user01", displayName: "张三", sessionVersion: 0 });
    expect(await verifyAgentAccountToken(`${token}x`)).toBeNull();
    expect(await verifyAgentAccountToken("garbage")).toBeNull();
  });

  it("密钥不匹配（换 secret）时验证失败", async () => {
    const token = await signAgentAccountToken({ id: "acc-1", username: "user01", displayName: "张三", sessionVersion: 0 });
    process.env.AUTH_SECRET = "rotated-secret";
    expect(await verifyAgentAccountToken(token)).toBeNull();
  });

  it("管理员重置密码递增会话版本后，旧 Token 不再匹配账号", async () => {
    const token = await signAgentAccountToken({ id: "acc-1", username: "user01", displayName: "张三", sessionVersion: 3 });
    const payload = await verifyAgentAccountToken(token);

    expect(payload).not.toBeNull();
    expect(isAgentAccountTokenCurrent(payload!, { id: "acc-1", sessionVersion: 3, isActive: true })).toBe(true);
    expect(isAgentAccountTokenCurrent(payload!, { id: "acc-1", sessionVersion: 4, isActive: true })).toBe(false);
  });
});
