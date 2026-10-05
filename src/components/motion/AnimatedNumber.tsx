"use client";

import { useRef, useState, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";

import { isReducedMotionPreferred, useReducedMotion } from "@/hooks/useReducedMotion";
import { MOTION_DURATION, MOTION_EASE } from "@/lib/motion/config";

gsap.registerPlugin(useGSAP);

type AnimatedNumberProps = {
  value: number;
  format?: (value: number) => ReactNode;
  precision?: number;
};

function finiteValue(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function normalizedPrecision(precision: number) {
  return Math.min(20, Math.max(0, Math.trunc(precision)));
}

function roundValue(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round((finiteValue(value) + Number.EPSILON) * factor) / factor;
}

function formatDefault(value: number) {
  return value.toLocaleString("zh-CN");
}

export function AnimatedNumber({
  value,
  format = formatDefault,
  precision = 0,
}: AnimatedNumberProps) {
  const safePrecision = normalizedPrecision(precision);
  const targetValue = roundValue(value, safePrecision);
  const [displayValue, setDisplayValue] = useState(targetValue);
  const currentValueRef = useRef(targetValue);
  const hasAnimatedRef = useRef(false);
  const reducedMotion = useReducedMotion();

  useGSAP(
    () => {
      const shouldReduceMotion = reducedMotion || isReducedMotionPreferred();
      const startValue = hasAnimatedRef.current ? currentValueRef.current : 0;
      hasAnimatedRef.current = true;

      if (shouldReduceMotion || startValue === targetValue) {
        currentValueRef.current = targetValue;
        setDisplayValue(targetValue);
        return;
      }

      const counter = { value: startValue };
      currentValueRef.current = startValue;
      setDisplayValue(roundValue(startValue, safePrecision));

      const tween = gsap.to(counter, {
        duration: MOTION_DURATION.numberRoll,
        ease: MOTION_EASE.decel,
        value: targetValue,
        onUpdate: () => {
          currentValueRef.current = counter.value;
          setDisplayValue(roundValue(counter.value, safePrecision));
        },
        onComplete: () => {
          currentValueRef.current = targetValue;
          setDisplayValue(targetValue);
        },
      });

      return () => tween.kill();
    },
    {
      dependencies: [reducedMotion, safePrecision, targetValue],
      revertOnUpdate: true,
    },
  );

  return <span data-animated-number>{format(displayValue)}</span>;
}
