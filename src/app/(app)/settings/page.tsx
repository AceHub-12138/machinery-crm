"use client";

import { Camera } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { ROLE_LABELS } from "@/lib/constants";
import { APP_NAME, DISPLAY_VERSION, CURRENT_RELEASE, CHANGELOG } from "@/lib/changelog";
import { PageContainer } from "@/components/layout/page-container";
import { UserAvatar } from "@/components/layout/user-avatar";
import { DesktopDownloadPanel } from "@/components/desktop-download";

const AVATAR_UPDATED_EVENT = "dachuan:avatar-updated";

type AvatarResponse = {
  avatarPath?: string;
  error?: string;
};

export default function SettingsPage() {
  const { data: session } = useSession();
  const [showHistory, setShowHistory] = useState(false);
  const [avatarPath, setAvatarPath] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const [avatarSuccess, setAvatarSuccess] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const history = CHANGELOG.slice(1);
  const shellUser = session?.user as
    | {
        email?: string | null;
        id?: string;
        name?: string | null;
        role?: string;
        viewScope?: string;
      }
    | undefined;

  useEffect(() => {
    if (!shellUser?.id) return;

    const controller = new AbortController();
    fetch("/api/upload/avatar", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as AvatarResponse;
        if (response.ok) setAvatarPath(data.avatarPath || "");
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [shellUser?.id]);

  async function uploadAvatar(file: File) {
    if (!shellUser?.id) {
      setAvatarError("当前登录状态无效，请重新登录后再试");
      return;
    }

    setAvatarError("");
    setAvatarSuccess("");
    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.set("userId", shellUser.id);
      formData.set("file", file);
      const response = await fetch("/api/upload/avatar", {
        body: formData,
        method: "POST",
      });
      const data = (await response.json()) as AvatarResponse;
      if (!response.ok || !data.avatarPath) {
        throw new Error(data.error || "头像上传失败，请重试");
      }

      setAvatarPath(data.avatarPath);
      setAvatarSuccess("头像已更新");
      window.dispatchEvent(
        new CustomEvent(AVATAR_UPDATED_EVENT, {
          detail: { avatarPath: data.avatarPath },
        }),
      );
    } catch (error) {
      setAvatarError(
        error instanceof Error ? error.message : "头像上传失败，请重试",
      );
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  return (
    <PageContainer variant="data" className="space-y-5">
      <h1 className="text-xl font-semibold text-gray-900">系统设置</h1>

      <div className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-6 shadow-[var(--shadow-card)]">
        <h2 className="text-sm font-semibold text-gray-700">当前账号信息</h2>
        <div className="flex flex-wrap items-center gap-4 rounded-[var(--radius-md)] bg-[var(--surface-muted)] p-4">
          <UserAvatar
            avatarPath={avatarPath}
            email={shellUser?.email}
            name={shellUser?.name}
            size="lg"
            userId={shellUser?.id}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--text-primary)]">个人头像</p>
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">
              支持 JPG、JPEG、PNG、WEBP，最大 2MB
            </p>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface-solid)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={uploadingAvatar || !shellUser?.id}
            onClick={() => avatarInputRef.current?.click()}
            type="button"
          >
            <Camera aria-hidden="true" className="size-4" />
            {uploadingAvatar ? "上传中…" : "更换头像"}
          </button>
          <input
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            aria-label="选择个人头像"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadAvatar(file);
            }}
            ref={avatarInputRef}
            type="file"
          />
        </div>
        {avatarError && (
          <p className="text-sm text-[var(--danger)]" role="alert">
            {avatarError}
          </p>
        )}
        {avatarSuccess && (
          <p className="text-sm text-[var(--success)]" role="status">
            {avatarSuccess}
          </p>
        )}
        <dl className="space-y-3">
          <div className="flex items-center gap-4">
            <dt className="text-sm text-gray-500 w-20">姓名</dt>
            <dd className="text-sm text-gray-900">{shellUser?.name}</dd>
          </div>
          <div className="flex items-center gap-4">
            <dt className="text-sm text-gray-500 w-20">账号</dt>
            <dd className="text-sm text-gray-900">{shellUser?.email}</dd>
          </div>
          <div className="flex items-center gap-4">
            <dt className="text-sm text-gray-500 w-20">角色</dt>
            <dd className="text-sm text-gray-900">
              {ROLE_LABELS[shellUser?.role || ""] || "-"}
            </dd>
          </div>
          <div className="flex items-center gap-4">
            <dt className="text-sm text-gray-500 w-20">数据范围</dt>
            <dd className="text-sm text-gray-900">
              {["PURCHASE", "WAREHOUSE"].includes(shellUser?.role || "")
                ? "不适用"
                : shellUser?.role === "SUPER_ADMIN" || shellUser?.viewScope === "ALL"
                  ? "全区域"
                  : "按负责省市"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-6 shadow-[var(--shadow-card)]">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">系统版本</h2>
        <p className="text-sm font-medium text-gray-900">{DISPLAY_VERSION}</p>
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-gray-500">当前版本更新内容（{CURRENT_RELEASE.date}）</p>
          <ol className="space-y-1 text-sm text-gray-600 list-decimal list-inside">
            {CURRENT_RELEASE.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ol>
        </div>

        {history.length > 0 && (
          <div className="mt-6 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => setShowHistory((value) => !value)}
              className="text-xs font-medium text-gray-500 hover:text-gray-900"
            >
              {showHistory ? "收起历史更新记录" : `查看历史更新记录（${history.length} 个版本）`}
            </button>
            {showHistory && (
              <div className="mt-3 space-y-4">
                {history.map((release) => (
                  <div key={release.version}>
                    <p className="text-sm font-medium text-gray-800">
                      {APP_NAME} {release.version}
                      <span className="text-xs font-normal text-gray-400"> · {release.date}</span>
                    </p>
                    <ol className="mt-1 space-y-1 text-sm text-gray-500 list-decimal list-inside">
                      {release.notes.map((note, index) => (
                        <li key={index}>{note}</li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-6 shadow-[var(--shadow-card)]">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">桌面客户端</h2>
        <DesktopDownloadPanel />
      </div>
    </PageContainer>
  );
}
