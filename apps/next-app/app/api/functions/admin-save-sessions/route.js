import { createDatabase } from "../../../../lib/database.js";
import { jsonNoStore, isValidSessionToken } from "../../../../lib/session-token.js";
import { findActiveAdmin } from "../../../../lib/admin-auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "درخواست نامعتبر است" }, 400);
  }

  const { token, course_id: courseId, sessions } = body ?? {};
  if (!isValidSessionToken(token)) return jsonNoStore({ error: "توکن ارسال نشده" }, 401);

  try {
    const database = createDatabase();
    const auth = await findActiveAdmin(database, token);
    if (!auth.admin) return jsonNoStore({ error: "دسترسی غیرمجاز — فقط مدیر" }, 403);
    if (!courseId) return jsonNoStore({ error: "شناسه‌ی دوره ارسال نشده" }, 400);
    if (!Array.isArray(sessions)) return jsonNoStore({ error: "فهرست جلسات نامعتبر است" }, 400);

    const rows = sessions.map((session) => ({
      ...(session?.id ? { id: session.id } : {}),
      course_id: courseId,
      session_number: Number(session?.session_number),
      title: String(session?.title ?? "").trim(),
      video_url: session?.video_url ? String(session.video_url).trim() : null,
      is_online: Boolean(session?.is_online),
      online_url: session?.is_online && session?.online_url ? String(session.online_url).trim() : null,
      scheduled_at: session?.is_online && session?.scheduled_at ? String(session.scheduled_at) : null,
    }));

    for (const row of rows) {
      if (!Number.isSafeInteger(row.session_number) || !row.title) {
        return jsonNoStore({ error: "هر جلسه باید شماره و عنوان داشته باشد" }, 400);
      }
    }

    const { error } = await database.rpc("replace_course_sessions", {
      p_course: courseId,
      p_sessions: rows,
    });
    if (error) {
      console.error("[api/functions/admin-save-sessions] Save failed:", error);
      return jsonNoStore({ error: "خطا در ذخیره‌ی جلسات" }, 500);
    }
    return jsonNoStore({ success: true });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/admin-save-sessions] Request failed:", error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس جلسات تنظیم نشده است" : error?.message ?? "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
