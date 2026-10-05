"use client";

import { useEffect, useRef, useState } from "react";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * 数字滚动。
 *
 * 直接把结果写进 DOM，而不是每秒 setState 60 次：
 * 一张屏上同时有十几个数字，用 React state 驱动动画会带来大量无意义的重渲染。
 * 首帧渲染最终值，保证服务端输出与 hydration 一致，
 * 滚动只在数值真的变化之后才发生，并响应系统的减少动效偏好。
 */
export function AnimatedNumber({
  value,
  format,
  duration = 900,
}: {
  value: number;
  format: (value: number) => string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const fromRef = useRef(value);
  const frameRef = useRef(0);

  // 首帧（含 SSR）渲染最终值；后续滚动由 effect 直接改写 DOM 文本
  const [initial] = useState(() => format(value));

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const from = fromRef.current;
    if (from === value || prefersReducedMotion()) {
      fromRef.current = value;
      node.textContent = format(value);
      return;
    }

    const integer = Number.isInteger(value);
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (value - from) * eased;
      node.textContent = format(integer ? Math.round(next) : next);
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [duration, format, value]);

  return <span ref={ref}>{initial}</span>;
}
