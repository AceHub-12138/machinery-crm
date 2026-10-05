"use client";

import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { isReducedMotionPreferred, useReducedMotion } from "@/hooks/useReducedMotion";
import { MOTION_DURATION, MOTION_EASE } from "@/lib/motion/config";

gsap.registerPlugin(useGSAP);

export type DialogProps = {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
};

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function Dialog({ open, title, description, children, footer, onClose }: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const reducedMotion = useReducedMotion();

  useGSAP(
    () => {
      const overlay = overlayRef.current;
      const panel = dialogRef.current;
      if (!open || !overlay || !panel) return;

      if (reducedMotion || isReducedMotionPreferred()) {
        gsap.set([overlay, panel], { clearProps: "opacity,transform" });
        return;
      }

      const timeline = gsap.timeline();
      timeline
        .fromTo(
          overlay,
          { opacity: 0 },
          { duration: MOTION_DURATION.normal, ease: MOTION_EASE.enter, opacity: 1 },
        )
        .fromTo(
          panel,
          { opacity: 0, scale: 0.96, y: 10 },
          {
            duration: MOTION_DURATION.normal,
            ease: MOTION_EASE.enter,
            opacity: 1,
            scale: 1,
            y: 0,
          },
          0,
        );
    },
    {
      dependencies: [open, reducedMotion],
      revertOnUpdate: true,
      scope: overlayRef,
    },
  );

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !portalTarget) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const animationFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusableElements = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusableElements.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open, portalTarget]);

  if (!open || !portalTarget) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      data-dialog-overlay
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      ref={overlayRef}
      role="presentation"
    >
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface-solid)] p-6 text-[var(--text-primary)] shadow-[var(--shadow-modal)]"
        data-dialog-panel
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold" id={titleId}>{title}</h2>
            {description && <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]" id={descriptionId}>{description}</p>}
          </div>
          <button
            aria-label="关闭"
            className="rounded-[var(--radius-sm)] p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--brand-orange)]"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        <div className="mt-6">{children}</div>
        {footer && <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>,
    portalTarget,
  );
}
