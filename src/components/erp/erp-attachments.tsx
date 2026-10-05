"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Paperclip, Trash2, X } from "lucide-react";
import { toProtectedUploadUrl } from "@/lib/upload-urls";

type Attachment = { id: string; fileName: string; fileUrl: string; uploadedById?: string };
const acceptedFiles = "image/*,.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx";
export const attachmentHelpText = "可上传到货、送货单、数量异常凭证、零件损坏等照片或电子版凭据。";

export async function deleteErpAttachment(attachmentId: string) {
  const response = await fetch(`/api/erp/attachments/${encodeURIComponent(attachmentId)}`, { method: "DELETE" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "删除附件失败");
  }
}

export async function deleteAfterSalesErpAttachment(attachmentId: string) {
  const response = await fetch(`/api/erp/attachments?id=${encodeURIComponent(attachmentId)}`, { method: "DELETE" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "附件删除失败");
  }
}

export function ErpAttachmentList({ attachments, deletingId, onDelete, canDelete }: { attachments: Attachment[]; deletingId?: string | null; onDelete?: (attachment: Attachment) => void; canDelete?: (attachment: Attachment) => boolean }) {
  return <div className="mt-2 space-y-1">{attachments.length ? attachments.map((attachment) => <div key={attachment.id} className="flex items-center justify-between gap-2"><a href={toProtectedUploadUrl(attachment.fileUrl)} target="_blank" rel="noreferrer" className="min-w-0 truncate text-sm text-blue-600 hover:underline">{attachment.fileName}</a>{onDelete && (!canDelete || canDelete(attachment)) && <button type="button" disabled={deletingId === attachment.id} aria-label={`删除附件：${attachment.fileName}`} onClick={() => onDelete(attachment)} className="inline-flex shrink-0 items-center gap-1 text-xs text-red-600 hover:text-red-700 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />{deletingId === attachment.id ? "删除中..." : "删除附件"}</button>}</div>) : <p className="text-xs text-gray-400">暂无附件</p>}</div>;
}

export async function uploadErpAttachments(entityType: string, entityId: string, files: File[]) {
  const failed: string[] = [];
  for (const file of files) {
    try {
      const form = new FormData();
      form.set("entityType", entityType); form.set("entityId", entityId); form.set("file", file);
      const response = await fetch("/api/erp/attachments", { method: "POST", body: form });
      if (!response.ok) failed.push(file.name);
    } catch {
      failed.push(file.name);
    }
  }
  return failed;
}

export function PendingErpAttachments({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return <div className="rounded-lg border border-gray-200 p-3">
    <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><Paperclip className="h-4 w-4" />附件</button><span className="text-xs text-gray-400">非必填，已选择 {files.length} 个文件</span></div>
    <input ref={inputRef} type="file" multiple accept={acceptedFiles} className="hidden" onChange={(event) => { const next = Array.from(event.target.files || []); if (next.length) onChange([...files, ...next]); event.target.value = ""; }} />
    <p className="mt-2 text-xs text-gray-500">{attachmentHelpText}</p>
    {files.length > 0 && <div className="mt-2 space-y-1">{files.map((file, index) => <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-xs"><span className="truncate">{file.name}</span><button type="button" title="移除附件" onClick={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))} className="text-gray-400 hover:text-red-600"><X className="h-3.5 w-3.5" /></button></div>)}</div>}
  </div>;
}

export function ErpAttachments({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { data: session } = useSession();
  const [items, setItems] = useState<Attachment[]>([]);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    const response = await fetch(`/api/erp/attachments?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`);
    if (response.ok) setItems(await response.json());
  }, [entityId, entityType]);

  useEffect(() => { void load(); }, [load]);

  async function upload(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    const failed = await uploadErpAttachments(entityType, entityId, files);
    setUploading(false);
    setError(failed.length ? `以下附件上传失败：${failed.join("、")}` : "");
    await load();
  }

  async function remove(attachment: Attachment) {
    if (!window.confirm(`确认从当前单据中删除附件“${attachment.fileName}”吗？删除操作会保留审计记录。`)) return;
    setDeletingId(attachment.id);
    setError("");
    try {
      if (entityType === "AFTER_SALES_ORDER") await deleteAfterSalesErpAttachment(attachment.id);
      else await deleteErpAttachment(attachment.id);
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : "删除附件失败");
    } finally {
      setDeletingId(null);
    }
  }

  const currentUser = session?.user as { id?: string; role?: string } | undefined;
  const canDelete = entityType === "AFTER_SALES_ORDER"
    ? (attachment: Attachment) => currentUser?.role === "SUPER_ADMIN" || Boolean(currentUser?.id && attachment.uploadedById === currentUser.id)
    : undefined;
  return <div className="mt-4 rounded border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">附件（非必填）</span><button type="button" disabled={uploading} onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"><Paperclip className="h-4 w-4" />{uploading ? "上传中..." : "附件"}</button><input ref={inputRef} type="file" multiple accept={acceptedFiles} className="hidden" onChange={(event) => { void upload(Array.from(event.target.files || [])); event.target.value = ""; }} /></div><p className="mt-2 text-xs text-gray-500">{attachmentHelpText}</p>{error && <p className="mt-1 text-xs text-red-600">{error}</p>}<ErpAttachmentList attachments={items} deletingId={deletingId} onDelete={remove} canDelete={canDelete} /></div>;
}
