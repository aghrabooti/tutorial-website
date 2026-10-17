import { jsonNoStore } from "../../../../lib/session-token.js";
import {
  LocalStorageError,
  saveUploadedFile,
  verifyStorageToken,
} from "../../../../lib/local-storage.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(authorization);
  if (!match) return jsonNoStore({ error: "مجوز آپلود معتبر نیست" }, 401);

  try {
    const claims = verifyStorageToken(match[1], "upload");
    const uploaded = await saveUploadedFile(request, claims);
    return jsonNoStore({ success: true, size: uploaded.size });
  } catch (error) {
    if (error instanceof LocalStorageError) {
      return jsonNoStore({ error: error.message }, error.status);
    }
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/storage/upload] Upload failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس ذخیره‌سازی تنظیم نشده است" : "آپلود فایل انجام نشد" },
      missingConfig ? 503 : 500
    );
  }
}
