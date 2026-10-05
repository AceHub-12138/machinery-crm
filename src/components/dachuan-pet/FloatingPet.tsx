"use client";

import Image from "next/image";
import { X } from "lucide-react";
import { useSession } from "next-auth/react";
import { CSSProperties, PointerEvent, useEffect, useRef, useState } from "react";
import { AgentExpression, AgentPresence, AgentAvatar } from "./AgentAvatar";
import { ChatPanel } from "./ChatPanel";
import petGreetingHighResolution from "./assets/pet-greeting-hd.png";
import petStandingHighResolution from "./assets/pet-standing-hd.png";
import styles from "./FloatingPet.module.css";

type PetMode = "standing" | "bubble" | "chat";

type PetPosition = {
  bottom: number;
  right: number;
};

type DragState = {
  bottom: number;
  pointerX: number;
  pointerY: number;
  right: number;
};

const DRAG_THRESHOLD = 6;
const SCREEN_GUTTER = 20;
const BUBBLE_SAFE_MARGIN = 12;
const BUBBLE_WIDTH = 214;
const DESKTOP_SIDEBAR_WIDTH = 312;
const PET_MOBILE_WIDTH = 112;
const PET_DESKTOP_WIDTH = 152;
const BUBBLE_LEFT_OVERHANG = 164;
const BUBBLE_RIGHT_OVERHANG = 160;

type BubblePlacement = "left" | "right" | "top";

export function FloatingPet() {
  const { data: session, status } = useSession();
  const [mode, setMode] = useState<PetMode>("standing");
  const [isGreeting, setIsGreeting] = useState(false);
  const [position, setPosition] = useState<PetPosition>({ bottom: 24, right: 24 });
  const [expression, setExpression] = useState<AgentExpression>("smile");
  const [presence] = useState<AgentPresence>("connecting");
  const [hasUnreadReply, setHasUnreadReply] = useState(false);
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const didDragRef = useRef(false);
  const petRef = useRef<HTMLDivElement>(null);
  const isSuperAdmin = session?.user.role === "SUPER_ADMIN";

  useEffect(() => {
    function updateViewportWidth() {
      setViewportWidth(window.innerWidth);
    }

    updateViewportWidth();
    window.addEventListener("resize", updateViewportWidth);
    return () => window.removeEventListener("resize", updateViewportWidth);
  }, []);

  if (status === "loading" || !isSuperAdmin) return null;

  function openChat() {
    setHasUnreadReply(false);
    setMode("chat");
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    didDragRef.current = false;
    dragStateRef.current = {
      bottom: position.bottom,
      pointerX: event.clientX,
      pointerY: event.clientY,
      right: position.right,
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const dragState = dragStateRef.current;
    const petElement = petRef.current;
    if (!dragState || !petElement) return;

    const deltaX = event.clientX - dragState.pointerX;
    const deltaY = event.clientY - dragState.pointerY;
    if (Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD) {
      didDragRef.current = true;
    }

    if (!didDragRef.current) return;

    const bounds = petElement.getBoundingClientRect();
    setPosition({
      bottom: Math.min(
        Math.max(dragState.bottom - deltaY, SCREEN_GUTTER),
        Math.max(SCREEN_GUTTER, window.innerHeight - bounds.height - SCREEN_GUTTER),
      ),
      right: Math.min(
        Math.max(dragState.right - deltaX, SCREEN_GUTTER),
        Math.max(SCREEN_GUTTER, window.innerWidth - bounds.width - SCREEN_GUTTER),
      ),
    });
  }

  function handlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
  }

  function handlePetClick() {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    openChat();
  }

  if (mode === "chat") {
    return (
      <ChatPanel
        expression={expression}
        presence={presence}
        onClose={() => setMode("bubble")}
        onMessageSubmit={() => setExpression("thinking")}
        onRestorePet={() => setMode("standing")}
      />
    );
  }

  const fixedPosition = { bottom: position.bottom, right: position.right };
  const petWidth =
    viewportWidth !== null && viewportWidth < 640
      ? PET_MOBILE_WIDTH
      : PET_DESKTOP_WIDTH;
  const petLeft = viewportWidth
    ? viewportWidth - position.right - petWidth
    : null;
  const protectedLeftEdge =
    viewportWidth !== null && viewportWidth >= 1024
      ? DESKTOP_SIDEBAR_WIDTH + BUBBLE_SAFE_MARGIN
      : BUBBLE_SAFE_MARGIN;
  const availableLeftSpace =
    petLeft === null ? null : petLeft - protectedLeftEdge;
  const isOnLeftHalf =
    petLeft !== null && viewportWidth !== null && petLeft < viewportWidth / 2;
  const availableRightSpace =
    petLeft === null || viewportWidth === null
      ? null
      : viewportWidth - petLeft - petWidth;
  const bubblePlacement: BubblePlacement =
    !isOnLeftHalf &&
    (availableLeftSpace === null || availableLeftSpace >= BUBBLE_LEFT_OVERHANG)
      ? "left"
      : availableRightSpace !== null && availableRightSpace >= BUBBLE_RIGHT_OVERHANG
        ? "right"
        : "top";
  const topBubbleLeft =
    bubblePlacement === "top" && petLeft !== null && viewportWidth !== null
      ? Math.min(
          Math.max(
            petLeft + petWidth / 2 - BUBBLE_WIDTH / 2,
            BUBBLE_SAFE_MARGIN,
          ),
          viewportWidth - BUBBLE_WIDTH - BUBBLE_SAFE_MARGIN,
        )
      : null;
  const bubbleStyle =
    topBubbleLeft !== null && petLeft !== null
      ? ({ "--bubble-left": `${topBubbleLeft - petLeft}px` } as CSSProperties)
      : undefined;

  if (mode === "bubble") {
    return (
      <div ref={petRef} style={fixedPosition} className="fixed z-40 print:hidden">
        <div className="absolute inset-0 rounded-full bg-orange-300/40 blur-md motion-safe:animate-[pulse_3s_ease-in-out_infinite]" />
        <button
          type="button"
          onClick={handlePetClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDragStart={(event) => event.preventDefault()}
          aria-label="打开小川 Ai 助手聊天面板"
          className={`relative flex size-[72px] touch-none select-none items-center justify-center overflow-hidden rounded-full border-2 border-white bg-orange-50 shadow-[0_12px_28px_rgba(238,125,44,0.35)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 ${styles.draggablePet}`}
        >
          <AgentAvatar
            expression={expression}
            presence={presence}
            alt="小川 Ai 助手悬浮头像"
            className="size-full"
            priority
          />
          {hasUnreadReply && (
            <span
              aria-label="有新的小川 Ai 助手回复"
              className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-full border-2 border-white bg-[#ee7d2c] text-[10px] font-semibold text-white shadow-sm"
            >
              1
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      ref={petRef}
      style={fixedPosition}
      className={`group fixed z-40 print:hidden ${styles.petFloat}`}
    >
      <div className={styles.petShadow} aria-hidden="true" />
      <div
        aria-hidden="true"
        style={bubbleStyle}
        className={`${styles.greetingBubble} ${
          bubblePlacement === "right"
            ? styles.greetingBubbleRight
            : bubblePlacement === "top"
              ? styles.greetingBubbleTop
              : ""
        } ${isGreeting ? styles.greetingBubbleVisible : ""}`}
      >
        你好，我是小川，<br />有什么问题都可以问我
      </div>
      <button
        type="button"
        onClick={handlePetClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDragStart={(event) => event.preventDefault()}
        onMouseEnter={() => setIsGreeting(true)}
        onMouseLeave={() => setIsGreeting(false)}
        onFocus={() => setIsGreeting(true)}
        onBlur={() => setIsGreeting(false)}
        aria-label="打开小川 Ai 助手聊天面板"
        className={`group relative z-10 block w-[112px] touch-none select-none sm:w-[152px] ${styles.petCard} ${styles.draggablePet} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2`}
      >
        <Image
          src={petStandingHighResolution}
          alt="小川 Ai 助手桌宠"
          draggable={false}
          className={`h-auto w-full transition-opacity duration-300 ${isGreeting ? "opacity-0" : "opacity-100"}`}
          priority
        />
        <Image
          src={petGreetingHighResolution}
          alt=""
          draggable={false}
          className={`pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-300 ${isGreeting ? styles.greetingPet : "opacity-0"}`}
        />
      </button>
      <button
        type="button"
        onClick={() => setMode("bubble")}
        aria-label="隐藏桌宠，显示悬浮头像"
        className="absolute right-0 top-4 inline-flex size-7 items-center justify-center rounded-full border border-orange-100 bg-white/95 text-gray-500 opacity-0 shadow-sm transition-opacity hover:text-gray-900 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 group-hover:opacity-100"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
