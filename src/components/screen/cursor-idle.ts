/**
 * kiosk 光标闲置状态机（纯逻辑，边界可单测）。
 *
 * 指针一动立即显示光标；距最后一次移动 ≥ CURSOR_IDLE_HIDE_MS 视为闲置，
 * 光标隐藏 —— LED 静置时画面无光标，操作时能正常看到鼠标点。
 */
export const CURSOR_IDLE_HIDE_MS = 3000;

export type CursorIdleSnapshot = {
  /** true = 应隐藏光标 */
  idle: boolean;
  /** 距进入闲置还剩多少毫秒（已闲置则为 0） */
  msUntilHide: number;
};

export function cursorIdleSnapshot(now: number, lastMovedAt: number): CursorIdleSnapshot {
  const elapsed = Math.max(0, now - lastMovedAt);
  return {
    idle: elapsed >= CURSOR_IDLE_HIDE_MS,
    msUntilHide: Math.max(0, CURSOR_IDLE_HIDE_MS - elapsed),
  };
}
