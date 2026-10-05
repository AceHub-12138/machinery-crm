import path from "path";

const DEFAULT_UPLOAD_ROOT = path.resolve(process.cwd(), "src", "app", "uploads");

export function getUploadRoot() {
  return path.resolve(process.env.UPLOAD_DIR || DEFAULT_UPLOAD_ROOT);
}

export function getUploadPath(...parts: string[]) {
  return path.join(getUploadRoot(), ...parts);
}

export function getUploadUrl(...parts: string[]) {
  return `/uploads/${parts.map(encodeURIComponent).join("/")}`;
}

export function sanitizeFileName(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  const baseName = path.basename(fileName, ext).replace(/[^a-zA-Z0-9._-]/g, "_");
  const safeBaseName = baseName.replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "file";
  return `${Date.now()}_${safeBaseName}${ext}`;
}

export function getContentType(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  const types: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".webm": "video/webm",
  };

  return types[ext] || "application/octet-stream";
}
