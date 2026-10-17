import { randomUUID } from "node:crypto";
import {
  findActivePostgresSessionUser,
  isValidSessionToken,
  jsonNoStore,
} from "../../../../lib/session-token.js";
import {
  createStorageToken,
  LocalStorageError,
  publicStorageUrl,
  safeImageFilename,
} from "../../../../lib/local-storage.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PDF_MAX_BYTES = 100 * 1024 * 1024;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES_BY_EXTENSION = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

function contentTypeForImage(type, filename) {
  const normalizedType = String(type ?? "").split(";", 1)[0].trim().toLowerCase();
  if (normalizedType) return normalizedType;
  const extension = String(filename ?? "").match(/\.[^.]+$/)?.[0]?.toLowerCase();
  return IMAGE_TYPES_BY_EXTENSION.get(extension) ?? "";
}

async function requirePostgresAdmin(token) {
  const result = await findActivePostgresSessionUser(token, ["id", "role"]);
  if (result.error) throw result.error;
  if (result.userError) throw result.userError;
  if (!result.session || !result.user) return { status: 401 };
  if (result.user.role !== "admin") return { status: 403 };
  return { admin: result.user };
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "درخواست نامعتبر است" }, 400);
  }

  const token = body?.token;
  const kind = body?.kind;
  if (!isValidSessionToken(token)) return jsonNoStore({ error: "توکن ارسال نشده" }, 401);

  try {
    const auth = await requirePostgresAdmin(token);
    if (auth.status === 401) return jsonNoStore({ error: "نشست معتبر نیست" }, 401);
    if (auth.status === 403) return jsonNoStore({ error: "دسترسی غیرمجاز — فقط مدیر" }, 403);

    if (kind === "pdf") {
      const courseId = String(body?.course_id ?? "").trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(courseId)) {
        return jsonNoStore({ error: "شناسه‌ی دوره معتبر نیست" }, 400);
      }

      const path = `${courseId}.pdf`;
      const uploadToken = createStorageToken({
        action: "upload",
        bucket: "course-files",
        path,
        maxBytes: PDF_MAX_BYTES,
        overwrite: true,
        ttlSeconds: 300,
      });
      return jsonNoStore({
        success: true,
        upload_url: "/api/storage/upload",
        upload_token: uploadToken,
        path,
      });
    }

    if (kind === "site" || kind === "image") {
      const contentType = contentTypeForImage(body?.content_type, body?.filename);
      const filename = safeImageFilename(body?.filename, contentType);
      const folder = kind === "site" ? "site" : "courses";
      const path = `${folder}/${randomUUID()}-${filename}`;
      const uploadToken = createStorageToken({
        action: "upload",
        bucket: "course-images",
        path,
        maxBytes: IMAGE_MAX_BYTES,
        overwrite: false,
        ttlSeconds: 300,
      });
      return jsonNoStore({
        success: true,
        upload_url: "/api/storage/upload",
        upload_token: uploadToken,
        path,
        public_url: publicStorageUrl(path),
      });
    }

    return jsonNoStore({ error: "نوع آپلود نامعتبر است" }, 400);
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/admin-upload-url] PostgreSQL/local storage request failed:", error?.message ?? error);
    return jsonNoStore(
      {
        error: missingConfig
          ? "سرویس آپلود تنظیم نشده است"
          : error instanceof LocalStorageError
            ? error.message
            : "خطای سرور",
      },
      missingConfig ? 503 : error instanceof LocalStorageError ? error.status : 500
    );
  }
}
