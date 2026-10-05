import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { prisma } from "@/lib/db";
import { loadXiaochuanConfig, normalizedBaseUrl, type XiaochuanConfig } from "@/lib/agent/config";

/**
 * Agent 模型服务配置存储：多套保存、单套生效，运行时"数据库优先、环境变量兜底"。
 *
 * 安全边界：
 * - API Key 用 AES-256-GCM 加密落库，密钥从 AUTH_SECRET 派生（不新增 env 配置；
 *   AUTH_SECRET 被轮换时旧密文解不开——按既有纪律 AUTH_SECRET 本就不应轮换）；
 * - 页面只见尾四位 hint，明文仅在服务端内存中出现；
 * - 数据库没有任何生效配置、或解密失败时，回落到 .env 的 XIAOCHUAN_LLM_*（现有行为不变）。
 */

const CIPHER_SALT = "dachuan-agent-model-config-v1";
const CACHE_TTL_MS = 30_000;

function cipherKey(): Buffer {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) throw new Error("AUTH_SECRET is required");
  return scryptSync(secret, CIPHER_SALT, 32);
}

export function encryptApiKey(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${authTag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptApiKey(cipherText: string): string | null {
  const parts = cipherText.split(".");
  if (parts.length !== 3) return null;
  try {
    const [iv, authTag, encrypted] = parts.map((part) => Buffer.from(part, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", cipherKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function apiKeyHint(plain: string): string {
  const tail = plain.slice(-4);
  return `****${tail}`;
}

type ActiveRuntimeModel = { baseUrl: string; model: string; apiKey: string };

type CacheState = { value: ActiveRuntimeModel | null; fetchedAt: number };

const globalCache = globalThis as unknown as { __xiaochuanModelConfigCache?: CacheState };

/** 读取当前生效的数据库配置（30s 进程内缓存）；无配置/解密失败返回 null */
export async function readActiveModelConfigCached(now = Date.now()): Promise<ActiveRuntimeModel | null> {
  const cache = globalCache.__xiaochuanModelConfigCache;
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.value;

  let value: ActiveRuntimeModel | null = null;
  try {
    const row = await prisma.agentModelConfig.findFirst({ where: { isActive: true } });
    if (row) {
      const apiKey = decryptApiKey(row.apiKeyCipher);
      if (apiKey) {
        value = { baseUrl: row.baseUrl, model: row.model, apiKey };
      } else {
        // 解密失败（如 AUTH_SECRET 已变更）：视为无配置，回落 env 并留下服务端日志
        console.error("[agent-model-config] 生效配置解密失败，已回落到环境变量配置");
      }
    }
  } catch {
    // 数据库暂不可用：回落 env，不阻塞对话
    value = null;
  }

  globalCache.__xiaochuanModelConfigCache = { value, fetchedAt: now };
  return value;
}

export function clearModelConfigCache() {
  globalCache.__xiaochuanModelConfigCache = undefined;
}

/**
 * 运行时配置解析：数据库生效配置优先（覆盖 apiKey/baseUrl/model 三项），
 * 其余护栏参数（超时/轮数/限流等）始终来自环境变量；数据库无配置时维持现状（纯 env）。
 */
export async function resolveXiaochuanRuntimeConfig(): Promise<XiaochuanConfig> {
  const active = await readActiveModelConfigCached();
  if (active) {
    const base = loadXiaochuanConfig(process.env, { allowMissingApiKey: true });
    return { ...base, apiKey: active.apiKey, baseUrl: normalizedBaseUrl(active.baseUrl), model: active.model };
  }
  return loadXiaochuanConfig(process.env);
}

/** 「测试连接」：对目标服务发一条最小补全请求，10 秒内 HTTP 200 即视为可用 */
export async function testModelConnection(input: { baseUrl: string; apiKey: string; model: string }): Promise<{ ok: boolean; message: string }> {
  let url: string;
  try {
    url = normalizedBaseUrl(input.baseUrl);
  } catch {
    return { ok: false, message: "接口地址必须是 http(s) 网址" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${url}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 8,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (response.ok) return { ok: true, message: "连接成功" };
    const detail = await response.text().catch(() => "");
    const snippet = detail.slice(0, 200).replace(/\s+/g, " ");
    return { ok: false, message: `服务返回 ${response.status}${snippet ? `：${snippet}` : ""}` };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, message: aborted ? "10 秒内没有连上，请检查地址与网络" : "连接失败，请检查地址与密钥" };
  } finally {
    clearTimeout(timer);
  }
}
