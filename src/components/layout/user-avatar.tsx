"use client";

import { useState } from "react";
import { toProtectedUploadUrl } from "@/lib/upload-urls";
import { cn } from "@/lib/utils";

const AVATAR_COLORS = [
  "bg-orange-500",
  "bg-sky-600",
  "bg-emerald-600",
  "bg-violet-600",
  "bg-rose-600",
  "bg-amber-600",
] as const;

export function getUserInitial(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || "川";
  return Array.from(source)[0]?.toUpperCase() || "川";
}

export function getUserAvatarColor(userId?: string | null) {
  const hash = Array.from(userId || "dachuan").reduce(
    (value, character) => (value * 31 + character.codePointAt(0)!) >>> 0,
    0,
  );
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

type UserAvatarProps = {
  avatarPath?: string | null;
  email?: string | null;
  name?: string | null;
  size?: "sm" | "md" | "lg";
  userId?: string | null;
};

export function UserAvatar({
  avatarPath,
  email,
  name,
  size = "md",
  userId,
}: UserAvatarProps) {
  const protectedAvatarPath = toProtectedUploadUrl(avatarPath);
  const [failedAvatarPath, setFailedAvatarPath] = useState<string | null>(null);
  const showImage = Boolean(
    protectedAvatarPath && protectedAvatarPath !== failedAvatarPath,
  );
  const avatarLabel = `${name || email || "用户"}的头像`;

  return (
    <span
      aria-label={showImage ? undefined : avatarLabel}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white shadow-sm ring-2 ring-[var(--surface-solid)]",
        getUserAvatarColor(userId),
        size === "sm" && "size-8 text-xs",
        size === "md" && "size-9 text-sm",
        size === "lg" && "size-11 text-base",
      )}
      role={showImage ? undefined : "img"}
    >
      {showImage ? (
        // The protected upload route requires the signed-in session cookie.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={avatarLabel}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailedAvatarPath(protectedAvatarPath)}
          src={protectedAvatarPath}
        />
      ) : (
        getUserInitial(name, email)
      )}
    </span>
  );
}
