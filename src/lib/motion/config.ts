import { CustomEase } from "gsap/CustomEase";
import { gsap } from "gsap";

gsap.registerPlugin(CustomEase);

// iOS 风格弹簧曲线（CustomEase 手绘；过冲约 15% 后稳住，视觉等效 iOS 弹簧物理）
CustomEase.create("motionEnterSpring", "M0,0 C0.28,1.45 0.5,1 1,1");

export const MOTION_DURATION = {
  instant: 0.1,
  fast: 0.15,
  normal: 0.3,
  slow: 0.45,
  process: 0.6,
  enter: 0.6,
  numberRoll: 1.1,
} as const;

export const MOTION_EASE = {
  enter: "motionEnterSpring",
  exit: "power2.in",
  decel: "expo.out",
  emphasis: "back.out(1.2)",
} as const;

export const MOTION_ENTER_OFFSET = 26;
export const MOTION_ENTER_SCALE = 0.97;
export const MOTION_STAGGER_INTERVAL = 0.12;
export const MOTION_SEQUENCE = {
  kpi: 0.15,
  rest: 0.4,
} as const;
