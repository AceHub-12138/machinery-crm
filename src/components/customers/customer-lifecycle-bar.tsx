"use client";

import { useGSAP } from "@gsap/react";
import type { CustomerStatus } from "@prisma/client";
import { gsap } from "gsap";
import { useRef } from "react";

import { isReducedMotionPreferred, useReducedMotion } from "@/hooks/useReducedMotion";
import { CUSTOMER_STATUS_LABELS } from "@/lib/constants";
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_STAGGER_INTERVAL,
} from "@/lib/motion/config";

gsap.registerPlugin(useGSAP);

const LIFECYCLE_STAGES = [
  "NEW_LEAD",
  "CONTACTED",
  "QUOTED",
  "NEGOTIATING",
  "WON",
] as const satisfies readonly CustomerStatus[];

type CustomerLifecycleBarProps = {
  customerId: string;
  status: CustomerStatus;
};

type LifecycleSession = {
  stageIndex: number;
  status: CustomerStatus;
};

const lifecycleSessionByCustomer = new Map<string, LifecycleSession>();

function stageProgress(stageIndex: number) {
  return stageIndex < 0 ? 0 : stageIndex / (LIFECYCLE_STAGES.length - 1);
}

export function CustomerLifecycleBar({
  customerId,
  status,
}: CustomerLifecycleBarProps) {
  const rootRef = useRef<HTMLElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const currentStageIndex = LIFECYCLE_STAGES.indexOf(
    status as (typeof LIFECYCLE_STAGES)[number],
  );
  const progress = stageProgress(currentStageIndex);
  const terminalStatus =
    status === "LOST" || status === "INACTIVE" ? status : null;

  useGSAP(
    () => {
      const root = rootRef.current;
      const progressLine = progressRef.current;
      if (!root || !progressLine) return;

      const nodes = Array.from(
        root.querySelectorAll<HTMLElement>("[data-lifecycle-node-index]"),
      );
      const currentNode = nodes[currentStageIndex];
      const activeNodes = nodes.filter(
        (node) => Number(node.dataset.lifecycleNodeIndex) <= currentStageIndex,
      );
      const terminalMarker = root.querySelector<HTMLElement>(
        "[data-lifecycle-terminal]",
      );
      const previousSession = lifecycleSessionByCustomer.get(customerId);
      const rememberSession = () => {
        lifecycleSessionByCustomer.set(customerId, {
          stageIndex: currentStageIndex,
          status,
        });
      };
      const showFinalState = () => {
        gsap.set(progressLine, { scaleX: progress });
        gsap.set(nodes, { clearProps: "opacity,transform" });
        if (terminalMarker) {
          gsap.set(terminalMarker, { clearProps: "opacity,transform" });
        }
      };

      if (reducedMotion || isReducedMotionPreferred()) {
        showFinalState();
        rememberSession();
        return;
      }

      if (previousSession && previousSession.status === status) {
        showFinalState();
        return;
      }

      if (currentStageIndex < 0) {
        showFinalState();
        if (terminalMarker) {
          gsap.fromTo(
            terminalMarker,
            { opacity: 0, y: 4 },
            {
              duration: MOTION_DURATION.normal,
              ease: MOTION_EASE.enter,
              opacity: 1,
              y: 0,
              onComplete: rememberSession,
            },
          );
        } else {
          rememberSession();
        }
        return;
      }

      const previousProgress = stageProgress(previousSession?.stageIndex ?? -1);
      const timeline = gsap.timeline({ onComplete: rememberSession });
      timeline.fromTo(
        progressLine,
        { scaleX: previousSession ? previousProgress : 0 },
        {
          duration: MOTION_DURATION.process,
          ease: MOTION_EASE.enter,
          scaleX: progress,
        },
      );

      const nodesToReveal = previousSession
        ? activeNodes.filter(
            (node) =>
              Number(node.dataset.lifecycleNodeIndex) > previousSession.stageIndex,
          )
        : activeNodes;
      if (nodesToReveal.length > 0) {
        timeline.fromTo(
          nodesToReveal,
          { opacity: 0.35, scale: 0.86 },
          {
            duration: MOTION_DURATION.normal,
            ease: MOTION_EASE.enter,
            opacity: 1,
            scale: 1,
            stagger: MOTION_STAGGER_INTERVAL,
          },
          0,
        );
      }

      if (currentNode) {
        timeline
          .to(currentNode, {
            duration: MOTION_DURATION.fast,
            ease: MOTION_EASE.emphasis,
            scale: 1.06,
          })
          .to(currentNode, {
            duration: MOTION_DURATION.fast,
            ease: MOTION_EASE.enter,
            scale: 1,
          });
      }
    },
    {
      dependencies: [customerId, currentStageIndex, reducedMotion, status],
      revertOnUpdate: true,
      scope: rootRef,
    },
  );

  return (
    <section
      aria-label="客户生命周期"
      className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface-solid)] px-4 py-4"
      data-customer-id={customerId}
      ref={rootRef}
    >
      <p className="sr-only">
        当前阶段：{CUSTOMER_STATUS_LABELS[status] || status}
      </p>
      <div className="relative min-w-[560px]">
        <div
          aria-hidden="true"
          className="absolute left-[10%] right-[10%] top-4 h-1 rounded-full bg-[var(--border)]"
        >
          <div
            className="h-full origin-left rounded-full bg-[var(--brand-orange)]"
            data-lifecycle-progress
            ref={progressRef}
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>

        <ol className="relative grid grid-cols-5">
          {LIFECYCLE_STAGES.map((stage, index) => {
            const active = currentStageIndex >= 0 && index <= currentStageIndex;
            const current = index === currentStageIndex;
            return (
              <li
                aria-current={current ? "step" : undefined}
                className="flex min-w-0 flex-col items-center px-1 text-center"
                data-lifecycle-node={stage}
                key={stage}
              >
                <span
                  aria-hidden="true"
                  className={`relative z-10 flex size-8 items-center justify-center rounded-full border-2 text-xs font-semibold ${
                    active
                      ? "border-[var(--brand-orange)] bg-[var(--brand-orange)] text-white"
                      : "border-[var(--border)] bg-[var(--surface-solid)] text-[var(--text-tertiary)]"
                  }`}
                  data-lifecycle-node-index={index}
                >
                  {index + 1}
                </span>
                <span
                  className={`mt-2 text-xs font-medium ${
                    active
                      ? "text-[var(--text-primary)]"
                      : "text-[var(--text-tertiary)]"
                  }`}
                >
                  {CUSTOMER_STATUS_LABELS[stage]}
                </span>
              </li>
            );
          })}
        </ol>

        {terminalStatus && (
          <div className="mt-3 flex justify-end">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1 text-xs text-[var(--text-tertiary)]"
              data-lifecycle-terminal={terminalStatus}
            >
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-[var(--neutral)]"
              />
              {CUSTOMER_STATUS_LABELS[terminalStatus]}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
