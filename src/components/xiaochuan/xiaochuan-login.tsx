"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import nextDynamic from "next/dynamic";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Spotlight } from "@/components/xiaochuan/spotlight";
import { shouldFallbackToCrmLogin } from "@/lib/agent/login-flow";

// Spline 3D 机器人：与 Agent 首页同一场景（右栏直接引用首页机器人）
const SplineScene = nextDynamic(() => import("@/components/xiaochuan/spline-scene").then((mod) => mod.SplineScene), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <span
        aria-label="3D 模型加载中"
        className="size-8 animate-spin rounded-full border-2 border-white/20 border-t-[#ee7d2c]"
      />
    </div>
  ),
});

const REMEMBER_KEY = "dachuan.xiaochuan.remember";

type LoginError = { message: string };

/**
 * Agent 平台登录界面：左侧登录表单（参考 CRM 登录页：logo + 账号/密码 + 记住账号），右侧沿用首页 3D 机器人。
 * 登录顺序：先试 Agent 独立账号（Agent 管理·账号管理中创建的名单），401 时回退 CRM 员工账号
 * （员工在外部直接打开 ai.dachuan.pro 也能登录，权限与平台内一致）。
 */
export function XiaochuanLogin() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        setUsername(saved);
        setRemember(true);
      }
    } catch {
      // 受限浏览器模式下 localStorage 不可用
    }
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      // 第一步：Agent 独立账号名单
      const agentResponse = await fetch("/api/agent/account/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (agentResponse.ok) {
        storeRemember();
        router.refresh();
        return;
      }
      const agentPayload = await agentResponse.json().catch(() => null) as { error?: string; code?: string } | null;
      if (!shouldFallbackToCrmLogin(agentResponse.status, agentPayload?.code)) {
        setError({ message: agentPayload?.error || "登录失败，请重试" });
        return;
      }

      // 第二步：回退 CRM 员工账号（NextAuth credentials）
      const result = await signIn("credentials", { email: username, password, redirect: false });
      if (result?.error) {
        setError({ message: "账号或密码错误" });
        return;
      }
      storeRemember();
      router.refresh();
    } catch {
      setError({ message: "网络中断了，请重试" });
    } finally {
      setLoading(false);
    }
  }

  function storeRemember() {
    try {
      if (remember) localStorage.setItem(REMEMBER_KEY, username);
      else localStorage.removeItem(REMEMBER_KEY);
    } catch {
      // 登录已成功，忽略存储失败
    }
  }

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-gradient-to-br from-white via-orange-50/70 to-neutral-100 dark:from-[#0a0a0a] dark:via-[#050505] dark:to-[#0a0a0a]">
      <Spotlight className="-top-24 left-1/4" />
      <div className="grid min-h-0 flex-1 md:grid-cols-2">
        {/* 左：登录表单 */}
        <div className="relative z-10 flex items-center justify-center overflow-y-auto p-8 md:p-16 lg:p-24">
          <div className="w-full max-w-[430px]">
            {/* logo 居中（同 CRM 登录页） */}
            <div className="mb-10 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="大川机床" className="h-14 w-auto max-w-[170px] object-contain" />
            </div>

            <div className="mb-8">
              <h1 className="bg-gradient-to-b from-neutral-900 to-neutral-500 bg-clip-text text-3xl font-bold text-transparent md:text-4xl dark:from-neutral-50 dark:to-neutral-400">
                Welcome Back！
              </h1>
              <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
                请输入账号和密码登录DachuanPro Agent
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="xiaochuan-username" className="mb-2 block text-sm font-semibold text-[#1f2937] dark:text-zinc-200">
                  账号
                </label>
                <input
                  id="xiaochuan-username"
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="h-12 w-full rounded-md border border-gray-300 bg-white px-3.5 text-sm text-gray-900 outline-none transition focus:border-[#EE7D2C] focus:ring-2 focus:ring-[#EE7D2C]/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  placeholder="请输入账号"
                  required
                />
              </div>

              <div>
                <label htmlFor="xiaochuan-password" className="mb-2 block text-sm font-semibold text-[#1f2937] dark:text-zinc-200">
                  密码
                </label>
                <div className="relative">
                  <input
                    id="xiaochuan-password"
                    type={showPassword ? "text" : "password"}
                    name="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-12 w-full rounded-md border border-gray-300 bg-white px-3.5 pr-12 text-sm text-gray-900 outline-none transition focus:border-[#EE7D2C] focus:ring-2 focus:ring-[#EE7D2C]/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    placeholder="请输入密码"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-[#5B5C60] transition hover:text-[#EE7D2C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#EE7D2C] dark:text-zinc-400"
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    title={showPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-[#5B5C60] dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 accent-[#EE7D2C]"
                />
                记住账号
              </label>

              {error && (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                  {error.message}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex h-12 w-full items-center justify-center rounded-md bg-[#EE7D2C] text-sm font-semibold text-white transition hover:bg-[#d96d22] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#EE7D2C] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {loading ? "登录中..." : "登录"}
              </button>
            </form>
          </div>
        </div>

        {/* 右：与 Agent 首页同款 Spline 3D 机器人（移动端隐藏，突出表单） */}
        <div className="relative hidden h-full md:block">
          <SplineScene className="h-full w-full" />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white/70 to-transparent dark:from-[#050505]"
          />
        </div>
      </div>
    </div>
  );
}
