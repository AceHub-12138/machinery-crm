import { createHash } from "node:crypto";
import { createClient } from "redis";
import type { AgentJtiStore } from "@/lib/agent-auth/token";

export type AgentAuthStateStore = AgentJtiStore & {
  consume(subject: string, limit: number, windowSeconds: number): Promise<boolean>;
  close(): Promise<void>;
};

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function createRedisAgentAuthStateStore(
  redisUrl: string,
  prefix = "dachuan:agent-auth",
): AgentAuthStateStore {
  const url = redisUrl.trim();
  if (!url) throw new Error("AGENT_AUTH_REDIS_URL is required");
  const normalizedPrefix = prefix.trim().replace(/:+$/, "");
  if (!normalizedPrefix) throw new Error("AGENT_AUTH_REDIS_PREFIX is required");
  const client = createClient({ url });
  let connecting: Promise<unknown> | null = null;

  async function ready() {
    if (client.isOpen) return client;
    connecting ??= client.connect().finally(() => {
      connecting = null;
    });
    await connecting;
    return client;
  }

  function jtiKey(jti: string) {
    return `${normalizedPrefix}:jti:${digest(jti)}`;
  }

  return {
    async register(jti, ttlSeconds) {
      const redis = await ready();
      await redis.set(jtiKey(jti), "active", { EX: ttlSeconds });
    },
    async isActive(jti) {
      const redis = await ready();
      return await redis.get(jtiKey(jti)) === "active";
    },
    async revoke(jti, ttlSeconds) {
      const redis = await ready();
      await redis.set(jtiKey(jti), "revoked", { EX: ttlSeconds });
    },
    async consume(subject, limit, windowSeconds) {
      if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSeconds) || windowSeconds < 1) {
        throw new Error("Invalid agent auth rate limit configuration");
      }
      const redis = await ready();
      const key = `${normalizedPrefix}:rate:${digest(subject)}`;
      const count = await redis.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n",
        { keys: [key], arguments: [String(windowSeconds)] },
      );
      return Number(count) <= limit;
    },
    async close() {
      await connecting?.catch(() => undefined);
      if (!client.isOpen) return;
      try {
        await client.quit();
      } catch {
        await client.disconnect().catch(() => undefined);
      }
    },
  };
}
