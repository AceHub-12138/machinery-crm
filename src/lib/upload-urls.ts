const PUBLIC_UPLOAD_PREFIX = "/uploads/";
const PROTECTED_UPLOAD_PREFIX = "/api/uploads/";

export function toProtectedUploadUrl(url: string | null | undefined) {
  if (!url || url.startsWith(PROTECTED_UPLOAD_PREFIX)) {
    return url || "";
  }

  if (url.startsWith(PUBLIC_UPLOAD_PREFIX)) {
    return `${PROTECTED_UPLOAD_PREFIX}${url.slice(PUBLIC_UPLOAD_PREFIX.length)}`;
  }

  return url;
}
