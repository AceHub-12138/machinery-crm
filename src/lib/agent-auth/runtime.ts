import { createAgentAuthRuntime, loadAgentAuthConfig } from "@/lib/agent-auth/config";

// 仅缓存不可变密钥配置和 Redis 连接；用户身份始终来自当前请求，不保存在这里。
let runtimePromise: ReturnType<typeof createAgentAuthRuntime> | null = null;

export function getAgentAuthRuntime() {
  runtimePromise ??= createAgentAuthRuntime(loadAgentAuthConfig());
  return runtimePromise;
}
