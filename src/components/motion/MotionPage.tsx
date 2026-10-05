"use client";

import { useRef, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";

import { isReducedMotionPreferred, useReducedMotion } from "@/hooks/useReducedMotion";
import { MOTION_DURATION, MOTION_EASE, MOTION_ENTER_OFFSET } from "@/lib/motion/config";

gsap.registerPlugin(useGSAP);

type MotionPageProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  enabled?: boolean;
  offset?: number;
};

export function MotionPage({
  children,
  className,
  delay = 0,
  enabled = true,
  offset = MOTION_ENTER_OFFSET,
}: MotionPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useGSAP(
    () => {
      const container = containerRef.current;
      if (!container) return;

      if (!enabled || reducedMotion || isReducedMotionPreferred()) {
        gsap.set(container, { clearProps: "opacity,transform" });
        return;
      }

      const fromVars: { opacity: number; y?: number } = { opacity: 0 };
      const toVars: {
        delay: number;
        duration: number;
        ease: string;
        opacity: number;
        y?: number;
      } = {
        delay,
        duration: MOTION_DURATION.enter,
        ease: MOTION_EASE.enter,
        opacity: 1,
      };
      if (offset !== 0) {
        fromVars.y = offset;
        toVars.y = 0;
      }

      gsap.fromTo(
        container,
        fromVars,
        toVars,
      );
    },
    {
      dependencies: [delay, enabled, offset, reducedMotion],
      revertOnUpdate: true,
      scope: containerRef,
    },
  );

  return (
    <div className={className} ref={containerRef}>
      {children}
    </div>
  );
}
