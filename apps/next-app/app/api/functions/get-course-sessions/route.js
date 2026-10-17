import { query } from "../../../../lib/postgres.js";
import { findActivePostgresSessionUser, isValidSessionToken, jsonNoStore } from "../../../../lib/session-token.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EARLY_ACCESS_MINUTES = 5;
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
      return jsonNoStore({ error: "دسترسی فقط برای خریداران است" }, 403);
    }

    const { rows: sessions } = await query(
      `SELECT *
       FROM public.course_sessions
       WHERE course_id = $1
       ORDER BY session_number ASC`,
      [normalizedCourseId]
    );

    const now = Date.now();
    const earlyAccessMs = EARLY_ACCESS_MINUTES * 60 * 1000;
    const visibleSessions = sessions.map((session) => {
      if (!session.is_online) return { ...session, online_available: true };

      const start = session.scheduled_at ? new Date(session.scheduled_at).getTime() : null;
      const available = start !== null && now >= start - earlyAccessMs;
      return {
        ...session,
        online_url: available ? session.online_url : null,
        online_available: available,
      };
    });

    return jsonNoStore({
      success: true,
      sessions: visibleSessions,
      server_now: new Date().toISOString(),
    });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/get-course-sessions] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس جلسات تنظیم نشده است" : "خطا در خواندن جلسات" },
      missingConfig ? 503 : 500
    );
  }
}
