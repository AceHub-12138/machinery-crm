"use client";

import { Suspense, lazy } from "react";

// 懒加载 Spline 运行时（约 2-4MB），避免拖慢平台其余页面
const Spline = lazy(() => import("@splinetool/react-spline"));

/**
 * Spline 3D 场景占位。
 * 当前使用 21st.dev 演示机器人场景，待设计师产出小川专属 .splinecode 后替换 SPLINE_SCENE_URL 即可。
 */
export const SPLINE_SCENE_URL = "https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode";

export function SplineScene({ className }: { className?: string }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center">
          <span
            aria-label="3D 模型加载中"
            className="size-8 animate-spin rounded-full border-2 border-white/20 border-t-[#ee7d2c]"
          />
        </div>
      }
    >
      <Spline scene={SPLINE_SCENE_URL} className={className} />
    </Suspense>
  );
}
