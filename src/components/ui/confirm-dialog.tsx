"use client";

import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { AlertTriangle, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import { isReducedMotionPreferred, useReducedMotion } from "@/hooks/useReducedMotion";
import { MOTION_DURATION, MOTION_EASE } from "@/lib/motion/config";

gsap.registerPlugin(useGSAP);

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function ConfirmDialog({
  open,
  title,
  description,
  onConfirm,
  onCancel,
  confirmText = "确认",
  cancelText = "取消",
  danger = false,
}: ConfirmDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
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
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const animationFrame = window.requestAnimationFrame(() => {
      cancelButtonRef.current?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      );
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus();
      } else if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onCancel, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-dialog-overlay
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      ref={overlayRef}
      role="presentation"
    >
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-md rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface-solid)] p-6 text-[var(--text-primary)] shadow-[var(--shadow-modal)]"
        data-dialog-panel
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start gap-4">
          {danger && (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--danger-soft)] text-[var(--danger)]">
              <AlertTriangle aria-hidden="true" className="size-5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold" id={titleId}>
              {title}
            </h2>
            {description && (
              <p
                className="mt-2 text-sm leading-6 text-[var(--text-secondary)]"
                id={descriptionId}
              >
                {description}
              </p>
            )}
          </div>
          <button
            aria-label={cancelText}
            className="rounded-[var(--radius-sm)] p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--brand-orange)]"
            onClick={onCancel}
            type="button"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            aria-label={cancelText}
            className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-solid)] px-4 py-2 text-sm font-medium hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]"
            onClick={onCancel}
            ref={cancelButtonRef}
            type="button"
          >
            {cancelText}
          </button>
          <button
            aria-label={confirmText}
            className={`rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 ${
              danger
                ? "bg-[var(--danger)] focus-visible:outline-[var(--danger)]"
                : "bg-[var(--brand-orange)] hover:bg-[var(--brand-orange-hover)] focus-visible:outline-[var(--brand-orange)]"
            }`}
            onClick={onConfirm}
            type="button"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
