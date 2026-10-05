"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 鼠标跟随追光（Spotlight）。
 * 用原生 CSS 渐变 + mousemove 实现，不引入 framer-motion，保持平台依赖干净。
 */
export function Spotlight({
  className,
  size = 260,
}: {
  className?: string;
  size?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const parent = container.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    setPosition({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  }, []);

  useEffect(() => {
    const parent = containerRef.current?.parentElement;
    if (!parent) return;
    parent.addEventListener("mousemove", handleMouseMove);
    return () => parent.removeEventListener("mousemove", handleMouseMove);
  }, [handleMouseMove]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute rounded-full opacity-0 blur-2xl transition-opacity duration-300",
        "bg-[radial-gradient(circle_at_center,rgba(238,125,44,0.22),rgba(238,125,44,0.07)_45%,transparent_75%)]",
        position ? "opacity-100" : "opacity-0",
        className,
      )}
      style={{
        width: size,
        height: size,
        left: position ? position.x - size / 2 : -size * 2,
        top: position ? position.y - size / 2 : -size * 2,
      }}
    />
  );
}
