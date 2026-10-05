"use client";

import { useRef, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";

import { isReducedMotionPreferred, useReducedMotion } from "@/hooks/useReducedMotion";
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_ENTER_OFFSET,
  MOTION_ENTER_SCALE,
  MOTION_STAGGER_INTERVAL,
} from "@/lib/motion/config";

gsap.registerPlugin(useGSAP);

type StaggerContainerProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

export function StaggerContainer({ children, className, delay = 0 }: StaggerContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useGSAP(
    () => {
      const items = Array.from(containerRef.current?.children ?? []);
      if (items.length === 0) return;

      if (reducedMotion || isReducedMotionPreferred()) {
        gsap.set(items, { clearProps: "opacity,transform" });
        return;
      }

      gsap.fromTo(
        items,
        { opacity: 0, y: MOTION_ENTER_OFFSET, scale: MOTION_ENTER_SCALE },
        {
          delay,
          duration: MOTION_DURATION.enter,
          ease: MOTION_EASE.enter,
          opacity: 1,
          scale: 1,
          stagger: MOTION_STAGGER_INTERVAL,
          y: 0,
        },
      );
    },
    {
      dependencies: [delay, reducedMotion],
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
