"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { signIn } from "next-auth/react";
import { DesktopDownloadLink } from "@/components/desktop-download";

const REMEMBER_KEY = "crm_remember_account";

// ---------------------------------------------------------------------------
// 眼球追踪小组件（来自原始素材，逻辑保持不变）
// Pupil: 只有瞳孔（用于黄色 / 白色小人）
// EyeBall: 带白色眼白 + 瞳孔（用于深灰 / 灰色小人）
// ---------------------------------------------------------------------------

interface PupilProps {
  size?: number;
  maxDistance?: number;
  pupilColor?: string;
  forceLookX?: number;
  forceLookY?: number;
}

const Pupil = ({
  size = 12,
  maxDistance = 5,
  pupilColor = "#1f2937",
  forceLookX,
  forceLookY,
}: PupilProps) => {
  const [mouseX, setMouseX] = useState<number>(0);
  const [mouseY, setMouseY] = useState<number>(0);
  const pupilRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const calculatePupilPosition = () => {
    if (!pupilRef.current) return { x: 0, y: 0 };
    if (forceLookX !== undefined && forceLookY !== undefined) {
      return { x: forceLookX, y: forceLookY };
    }
    const pupil = pupilRef.current.getBoundingClientRect();
    const pupilCenterX = pupil.left + pupil.width / 2;
    const pupilCenterY = pupil.top + pupil.height / 2;
    const deltaX = mouseX - pupilCenterX;
    const deltaY = mouseY - pupilCenterY;
    const distance = Math.min(Math.sqrt(deltaX ** 2 + deltaY ** 2), maxDistance);
    const angle = Math.atan2(deltaY, deltaX);
    return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
  };

  const pupilPosition = calculatePupilPosition();

  return (
    <div
      ref={pupilRef}
      className="rounded-full"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: pupilColor,
        transform: `translate(${pupilPosition.x}px, ${pupilPosition.y}px)`,
        transition: "transform 0.1s ease-out",
      }}
    />
  );
};

interface EyeBallProps {
  size?: number;
  pupilSize?: number;
  maxDistance?: number;
  eyeColor?: string;
  pupilColor?: string;
  isBlinking?: boolean;
  forceLookX?: number;
  forceLookY?: number;
}

const EyeBall = ({
  size = 18,
  pupilSize = 7,
  maxDistance = 5,
  eyeColor = "#ffffff",
  pupilColor = "#1f2937",
  isBlinking = false,
  forceLookX,
  forceLookY,
}: EyeBallProps) => {
  const [mouseX, setMouseX] = useState<number>(0);
  const [mouseY, setMouseY] = useState<number>(0);
  const eyeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const calculatePupilPosition = () => {
    if (!eyeRef.current) return { x: 0, y: 0 };
    if (forceLookX !== undefined && forceLookY !== undefined) {
      return { x: forceLookX, y: forceLookY };
    }
    const eye = eyeRef.current.getBoundingClientRect();
    const eyeCenterX = eye.left + eye.width / 2;
    const eyeCenterY = eye.top + eye.height / 2;
    const deltaX = mouseX - eyeCenterX;
    const deltaY = mouseY - eyeCenterY;
    const distance = Math.min(Math.sqrt(deltaX ** 2 + deltaY ** 2), maxDistance);
    const angle = Math.atan2(deltaY, deltaX);
    return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
  };

  const pupilPosition = calculatePupilPosition();

  return (
    <div
      ref={eyeRef}
      className="flex items-center justify-center rounded-full transition-all duration-150"
      style={{
        width: `${size}px`,
        height: isBlinking ? "2px" : `${size}px`,
        backgroundColor: eyeColor,
        overflow: "hidden",
      }}
    >
      {!isBlinking && (
        <div
          className="rounded-full"
          style={{
            width: `${pupilSize}px`,
            height: `${pupilSize}px`,
            backgroundColor: pupilColor,
            transform: `translate(${pupilPosition.x}px, ${pupilPosition.y}px)`,
            transition: "transform 0.1s ease-out",
          }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 登录页
// ---------------------------------------------------------------------------

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // 小人动画相关状态
  const [mouseX, setMouseX] = useState<number>(0);
  const [mouseY, setMouseY] = useState<number>(0);
  const [isDarkBlinking, setIsDarkBlinking] = useState(false);
  const [isGreyBlinking, setIsGreyBlinking] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isLookingAtEachOther, setIsLookingAtEachOther] = useState(false);
  const [isPeeking, setIsPeeking] = useState(false);

  const darkRef = useRef<HTMLDivElement>(null);
  const greyRef = useRef<HTMLDivElement>(null);
  const yellowRef = useRef<HTMLDivElement>(null);
  const whiteRef = useRef<HTMLDivElement>(null);

  // 记住账号
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        setEmail(saved);
        setRemember(true);
      } else {
        setRemember(false);
      }
    } catch {
      // 受限浏览器模式下 localStorage 可能不可用
    }
  }, []);

  // 鼠标位置（用于小人身体倾斜）
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // 深灰小人随机眨眼
  useEffect(() => {
    const getRandomBlinkInterval = () => Math.random() * 4000 + 3000;
    const scheduleBlink = (): ReturnType<typeof setTimeout> =>
      setTimeout(() => {
        setIsDarkBlinking(true);
        setTimeout(() => {
          setIsDarkBlinking(false);
          timeout = scheduleBlink();
        }, 150);
      }, getRandomBlinkInterval());
    let timeout = scheduleBlink();
    return () => clearTimeout(timeout);
  }, []);

  // 灰色小人随机眨眼
  useEffect(() => {
    const getRandomBlinkInterval = () => Math.random() * 4000 + 3000;
    const scheduleBlink = (): ReturnType<typeof setTimeout> =>
      setTimeout(() => {
        setIsGreyBlinking(true);
        setTimeout(() => {
          setIsGreyBlinking(false);
          timeout = scheduleBlink();
        }, 150);
      }, getRandomBlinkInterval());
    let timeout = scheduleBlink();
    return () => clearTimeout(timeout);
  }, []);

  // 开始输入时小人互相对视一下，然后恢复跟随鼠标
  useEffect(() => {
    if (isTyping) {
      setIsLookingAtEachOther(true);
      const timer = setTimeout(() => setIsLookingAtEachOther(false), 800);
      return () => clearTimeout(timer);
    }
    setIsLookingAtEachOther(false);
  }, [isTyping]);

  // 显示密码时小人扭头不看，深灰偶尔偷瞄
  useEffect(() => {
    if (password.length > 0 && showPassword) {
      const peek = setTimeout(() => {
        setIsPeeking(true);
        setTimeout(() => setIsPeeking(false), 800);
      }, Math.random() * 3000 + 2000);
      return () => clearTimeout(peek);
    }
    setIsPeeking(false);
  }, [password, showPassword, isPeeking]);

  const calculatePosition = (ref: React.RefObject<HTMLDivElement | null>) => {
    if (!ref.current) return { faceX: 0, faceY: 0, bodySkew: 0 };
    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 3;
    const deltaX = mouseX - centerX;
    const deltaY = mouseY - centerY;
    const faceX = Math.max(-15, Math.min(15, deltaX / 20));
    const faceY = Math.max(-10, Math.min(10, deltaY / 30));
    const bodySkew = Math.max(-6, Math.min(6, -deltaX / 120));
    return { faceX, faceY, bodySkew };
  };

  const darkPos = calculatePosition(darkRef);
  const greyPos = calculatePosition(greyRef);
  const yellowPos = calculatePosition(yellowRef);
  const whitePos = calculatePosition(whiteRef);

  const passwordVisible = password.length > 0 && showPassword;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError("账号或密码错误");
      } else {
        try {
          if (remember) {
            localStorage.setItem(REMEMBER_KEY, email);
          } else {
            localStorage.removeItem(REMEMBER_KEY);
          }
        } catch {
          // 登录已成功，忽略存储失败
        }
        window.location.assign("/");
      }
    } catch {
      setError("登录失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50">
      {/* 移动端 / 小屏：简洁表单 */}
      <section className="flex min-h-screen items-center justify-center px-4 lg:hidden">
        <div className="w-full max-w-sm">
          <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
            <div className="mb-8 text-center">
              <img
                src="/logo.png"
                alt="大川机床"
                className="mx-auto h-14 w-auto object-contain"
              />
            </div>

            <form onSubmit={handleSubmit} method="post" action="/login" className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">账号</label>
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="请输入账号"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">密码</label>
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="请输入密码"
                  required
                />
              </div>

              <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                />
                记住账号
              </label>

              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "登录中..." : "登录"}
              </button>

              <div className="flex justify-center pt-1">
                <DesktopDownloadLink />
              </div>
            </form>
          </div>
        </div>
      </section>

      {/* 桌面端：左侧插画 + 右侧表单 */}
      <section className="hidden min-h-screen lg:grid lg:grid-cols-[minmax(560px,1.08fr)_minmax(440px,0.92fr)]">
        {/* 左侧橙色插画区 */}
        <div
          className="relative flex min-h-screen flex-col overflow-hidden px-10 py-9 xl:px-14 xl:py-11"
          style={{ background: "linear-gradient(135deg,#a8531a,#ee7d2c)" }}
        >
          {/* 左上角 Dachuan.Pro 标记 */}
          <div className="relative z-10">
            <div className="inline-flex flex-col">
              <div className="flex items-center text-2xl font-extrabold italic text-white">
                <span>Dachuan</span>
                <span className="ml-1 rounded-sm bg-white px-1.5 py-0.5 text-lg not-italic text-[#EE7D2C] shadow-sm">
                  .Pro
                </span>
              </div>
              <span className="mt-2 h-1 w-16 bg-white" />
            </div>
          </div>

          {/* 小人插画 */}
          <div className="relative z-10 flex flex-1 items-end justify-center">
            <div className="relative" style={{ width: "550px", height: "400px" }}>
              {/* 深灰高个 —— 后排 */}
              <div
                ref={darkRef}
                className="absolute bottom-0 transition-all duration-700 ease-in-out"
                style={{
                  left: "70px",
                  width: "180px",
                  height: isTyping || (password.length > 0 && !showPassword) ? "440px" : "400px",
                  backgroundColor: "#1f2937",
                  borderRadius: "10px 10px 0 0",
                  zIndex: 1,
                  transform: passwordVisible
                    ? "skewX(0deg)"
                    : isTyping || (password.length > 0 && !showPassword)
                      ? `skewX(${(darkPos.bodySkew || 0) - 12}deg) translateX(40px)`
                      : `skewX(${darkPos.bodySkew || 0}deg)`,
                  transformOrigin: "bottom center",
                }}
              >
                <div
                  className="absolute flex gap-8 transition-all duration-700 ease-in-out"
                  style={{
                    left: passwordVisible
                      ? "20px"
                      : isLookingAtEachOther
                        ? "55px"
                        : `${45 + darkPos.faceX}px`,
                    top: passwordVisible
                      ? "35px"
                      : isLookingAtEachOther
                        ? "65px"
                        : `${40 + darkPos.faceY}px`,
                  }}
                >
                  <EyeBall
                    size={18}
                    pupilSize={7}
                    maxDistance={5}
                    eyeColor="#ffffff"
                    pupilColor="#1f2937"
                    isBlinking={isDarkBlinking}
                    forceLookX={passwordVisible ? (isPeeking ? 4 : -4) : isLookingAtEachOther ? 3 : undefined}
                    forceLookY={passwordVisible ? (isPeeking ? 5 : -4) : isLookingAtEachOther ? 4 : undefined}
                  />
                  <EyeBall
                    size={18}
                    pupilSize={7}
                    maxDistance={5}
                    eyeColor="#ffffff"
                    pupilColor="#1f2937"
                    isBlinking={isDarkBlinking}
                    forceLookX={passwordVisible ? (isPeeking ? 4 : -4) : isLookingAtEachOther ? 3 : undefined}
                    forceLookY={passwordVisible ? (isPeeking ? 5 : -4) : isLookingAtEachOther ? 4 : undefined}
                  />
                </div>
              </div>

              {/* 灰色中个 —— 中排 */}
              <div
                ref={greyRef}
                className="absolute bottom-0 transition-all duration-700 ease-in-out"
                style={{
                  left: "240px",
                  width: "120px",
                  height: "310px",
                  backgroundColor: "#5B5C60",
                  borderRadius: "8px 8px 0 0",
                  zIndex: 2,
                  transform: passwordVisible
                    ? "skewX(0deg)"
                    : isLookingAtEachOther
                      ? `skewX(${(greyPos.bodySkew || 0) * 1.5 + 10}deg) translateX(20px)`
                      : isTyping || (password.length > 0 && !showPassword)
                        ? `skewX(${(greyPos.bodySkew || 0) * 1.5}deg)`
                        : `skewX(${greyPos.bodySkew || 0}deg)`,
                  transformOrigin: "bottom center",
                }}
              >
                <div
                  className="absolute flex gap-6 transition-all duration-700 ease-in-out"
                  style={{
                    left: passwordVisible
                      ? "10px"
                      : isLookingAtEachOther
                        ? "32px"
                        : `${26 + greyPos.faceX}px`,
                    top: passwordVisible
                      ? "28px"
                      : isLookingAtEachOther
                        ? "12px"
                        : `${32 + greyPos.faceY}px`,
                  }}
                >
                  <EyeBall
                    size={16}
                    pupilSize={6}
                    maxDistance={4}
                    eyeColor="#ffffff"
                    pupilColor="#1f2937"
                    isBlinking={isGreyBlinking}
                    forceLookX={passwordVisible ? -4 : isLookingAtEachOther ? 0 : undefined}
                    forceLookY={passwordVisible ? -4 : isLookingAtEachOther ? -4 : undefined}
                  />
                  <EyeBall
                    size={16}
                    pupilSize={6}
                    maxDistance={4}
                    eyeColor="#ffffff"
                    pupilColor="#1f2937"
                    isBlinking={isGreyBlinking}
                    forceLookX={passwordVisible ? -4 : isLookingAtEachOther ? 0 : undefined}
                    forceLookY={passwordVisible ? -4 : isLookingAtEachOther ? -4 : undefined}
                  />
                </div>
              </div>

              {/* 黄色半圆 —— 前排左 */}
              <div
                ref={yellowRef}
                className="absolute bottom-0 transition-all duration-700 ease-in-out"
                style={{
                  left: "0px",
                  width: "240px",
                  height: "200px",
                  zIndex: 3,
                  backgroundColor: "#fbbf24",
                  borderRadius: "120px 120px 0 0",
                  transform: passwordVisible
                    ? "skewX(0deg)"
                    : `skewX(${yellowPos.bodySkew || 0}deg)`,
                  transformOrigin: "bottom center",
                }}
              >
                <div
                  className="absolute flex gap-8 transition-all duration-200 ease-out"
                  style={{
                    left: passwordVisible ? "50px" : `${82 + (yellowPos.faceX || 0)}px`,
                    top: passwordVisible ? "85px" : `${90 + (yellowPos.faceY || 0)}px`,
                  }}
                >
                  <Pupil
                    size={12}
                    maxDistance={5}
                    pupilColor="#1f2937"
                    forceLookX={passwordVisible ? -5 : undefined}
                    forceLookY={passwordVisible ? -4 : undefined}
                  />
                  <Pupil
                    size={12}
                    maxDistance={5}
                    pupilColor="#1f2937"
                    forceLookX={passwordVisible ? -5 : undefined}
                    forceLookY={passwordVisible ? -4 : undefined}
                  />
                </div>
              </div>

              {/* 白色 —— 前排右（带嘴巴） */}
              <div
                ref={whiteRef}
                className="absolute bottom-0 transition-all duration-700 ease-in-out"
                style={{
                  left: "310px",
                  width: "140px",
                  height: "230px",
                  backgroundColor: "#f8fafc",
                  border: "1px solid rgba(255,255,255,0.7)",
                  borderRadius: "70px 70px 0 0",
                  zIndex: 4,
                  transform: passwordVisible
                    ? "skewX(0deg)"
                    : `skewX(${whitePos.bodySkew || 0}deg)`,
                  transformOrigin: "bottom center",
                }}
              >
                <div
                  className="absolute flex gap-6 transition-all duration-200 ease-out"
                  style={{
                    left: passwordVisible ? "20px" : `${52 + (whitePos.faceX || 0)}px`,
                    top: passwordVisible ? "35px" : `${40 + (whitePos.faceY || 0)}px`,
                  }}
                >
                  <Pupil
                    size={12}
                    maxDistance={5}
                    pupilColor="#1f2937"
                    forceLookX={passwordVisible ? -5 : undefined}
                    forceLookY={passwordVisible ? -4 : undefined}
                  />
                  <Pupil
                    size={12}
                    maxDistance={5}
                    pupilColor="#1f2937"
                    forceLookX={passwordVisible ? -5 : undefined}
                    forceLookY={passwordVisible ? -4 : undefined}
                  />
                </div>
                <div
                  className="absolute h-[4px] w-20 rounded-full bg-[#1f2937] transition-all duration-200 ease-out"
                  style={{
                    left: passwordVisible ? "10px" : `${40 + (whitePos.faceX || 0)}px`,
                    top: passwordVisible ? "88px" : `${88 + (whitePos.faceY || 0)}px`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* 右侧表单区 */}
        <div className="flex min-h-screen items-center justify-center bg-white px-10 py-12 xl:px-16">
          <div className="w-full max-w-[430px]">
            {/* logo 居中，无文字 */}
            <div className="mb-10 flex items-center justify-center">
              <img
                src="/logo.png"
                alt="大川机床"
                className="h-14 w-auto max-w-[170px] object-contain"
              />
            </div>

            <div className="mb-8">
              <h2 className="text-3xl font-bold text-[#1f2937]">欢迎回来</h2>
              <p className="mt-2 text-sm text-[#5B5C60]">请输入账号和密码登录 CRM 系统</p>
            </div>

            <form onSubmit={handleSubmit} method="post" action="/login" className="space-y-5">
              <div>
                <label htmlFor="desktop-username" className="mb-2 block text-sm font-semibold text-[#1f2937]">
                  账号
                </label>
                <input
                  id="desktop-username"
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onFocus={() => setIsTyping(true)}
                  onBlur={() => setIsTyping(false)}
                  className="h-12 w-full rounded-md border border-gray-300 bg-white px-3.5 text-sm text-gray-900 outline-none transition focus:border-[#EE7D2C] focus:ring-2 focus:ring-[#EE7D2C]/20"
                  placeholder="请输入账号"
                  required
                />
              </div>

              <div>
                <label htmlFor="desktop-password" className="mb-2 block text-sm font-semibold text-[#1f2937]">
                  密码
                </label>
                <div className="relative">
                  <input
                    id="desktop-password"
                    type={showPassword ? "text" : "password"}
                    name="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onFocus={() => setIsTyping(true)}
                    onBlur={() => setIsTyping(false)}
                    className="h-12 w-full rounded-md border border-gray-300 bg-white px-3.5 pr-12 text-sm text-gray-900 outline-none transition focus:border-[#EE7D2C] focus:ring-2 focus:ring-[#EE7D2C]/20"
                    placeholder="请输入密码"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-[#5B5C60] transition hover:text-[#EE7D2C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#EE7D2C]"
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    title={showPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-[#5B5C60]">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 accent-[#EE7D2C]"
                />
                记住账号
              </label>

              {error && (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex h-12 w-full items-center justify-center rounded-md bg-[#EE7D2C] text-sm font-semibold text-white transition hover:bg-[#d96d22] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#EE7D2C] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {loading ? "登录中..." : "登录"}
              </button>

              <div className="flex justify-center pt-1">
                <DesktopDownloadLink />
              </div>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
