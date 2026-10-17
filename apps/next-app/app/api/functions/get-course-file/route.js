import { query } from "../../../../lib/postgres.js";
import { jsonNoStore, isValidSessionToken, findActivePostgresSessionUser } from "../../../../lib/session-token.js";
import {
  createStorageToken,
  getStorageFileStat,
  LocalStorageError,
} from "../../../../lib/local-storage.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PDF_MAX_BYTES = 100 * 1024 * 1024;
const DOWNLOAD_TTL_SECONDS = 300;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "درخواست نامعتبر است" }, 400);
  }

  const token = body?.token;
  const courseId = body?.course_id;
  if (!isValidSessionToken(token)) return jsonNoStore({ error: "توکن ارسال نشده" }, 401);
  if (courseId === undefined || courseId === null || !String(courseId).trim()) {
    return jsonNoStore({ error: "شناسه‌ی دوره ارسال نشده" }, 400);
  }
  const normalizedCourseId = String(courseId).trim();
  if (!UUID_PATTERN.test(normalizedCourseId)) {
    return jsonNoStore({ error: "شناسه‌ی دوره معتبر نیست" }, 400);
  }

  try {
    const auth = await findActivePostgresSessionUser(token, ["id"]);
    if (auth.error && !auth.expired) throw auth.error;
    if (auth.userError) throw auth.userError;
    if (!auth.user) return jsonNoStore({ error: "نشست معتبر نیست" }, 401);

    const ownership = await query(
      `SELECT 1 AS owned
       FROM public.orders
       WHERE user_id = $1
         AND status = 'paid'
         AND $2 = ANY(course_ids)
       LIMIT 1`,
      [String(auth.user.id), normalizedCourseId]
    );
    if (ownership.rows.length === 0) {
      return jsonNoStore({ error: "این فایل فقط برای خریداران فعال است" }, 403);
    }

    const path = `${normalizedCourseId}.pdf`;
    await getStorageFileStat("course-files", path);
    const downloadToken = createStorageToken({
      action: "download",
      bucket: "course-files",
      path,
      maxBytes: PDF_MAX_BYTES,
      ttlSeconds: DOWNLOAD_TTL_SECONDS,
    });

    return jsonNoStore({
      success: true,
      url: `/api/storage/download?token=${encodeURIComponent(downloadToken)}`,
    });
  } catch (error) {
    if (error instanceof LocalStorageError && error.status === 404) {
      return jsonNoStore({ error: "فایل این محصول هنوز بارگذاری نشده است" }, 404);
    }
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/get-course-file] Request failed:", error?.message ?? error);
    return jsonNoStore(
      {
        error: missingConfig
          ? "سرویس فایل تنظیم نشده است"
          : "خطا در آماده‌سازی فایل",
      },
      missingConfig ? 503 : error instanceof LocalStorageError ? error.status : 500
    );
  }
}
