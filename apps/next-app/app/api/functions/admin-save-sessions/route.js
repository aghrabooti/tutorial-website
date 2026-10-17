import { withTransaction } from "../../../../lib/postgres.js";
import { findActivePostgresAdmin } from "../../../../lib/admin-auth.js";
import { jsonNoStore, isValidSessionToken } from "../../../../lib/session-token.js";

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
    const auth = await findActivePostgresAdmin(token);
    if (auth.error && !auth.expired) throw auth.error;
    if (auth.userError) throw auth.userError;
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
      if (!Number.isFinite(row.session_number) || !row.title) {
        return jsonNoStore({ error: "هر جلسه باید شماره و عنوان داشته باشد" }, 400);
      }
    }

    await withTransaction(async (client) => {
      const { rows: existing } = await client.query(
        "SELECT id FROM public.course_sessions WHERE course_id = $1",
        [courseId]
      );
      const keepIds = new Set(rows.filter((row) => row.id).map((row) => String(row.id)));
      const toDelete = existing
        .map((row) => String(row.id))
        .filter((id) => !keepIds.has(id));

      if (toDelete.length > 0) {
        await client.query(
          "DELETE FROM public.course_sessions WHERE course_id = $1 AND NOT (id = ANY($2::uuid[]))",
          [courseId, [...keepIds]]
        );
      } else if (rows.length === 0) {
        await client.query("DELETE FROM public.course_sessions WHERE course_id = $1", [courseId]);
      }

      for (const row of rows) {
        const columns = [
          ...(row.id ? ["id"] : []),
          "course_id",
          "session_number",
          "title",
          "video_url",
          "is_online",
          "online_url",
          "scheduled_at",
        ];
        const values = [
          ...(row.id ? [row.id] : []),
          row.course_id,
          row.session_number,
          row.title,
          row.video_url,
          row.is_online,
          row.online_url,
          row.scheduled_at,
        ];
        const placeholders = values.map((_, index) => `$${index + 1}`);
        const updates = columns
          .filter((column) => column !== "id")
          .map((column) => `${column} = EXCLUDED.${column}`)
          .join(", ");
        await client.query(
          `INSERT INTO public.course_sessions (${columns.join(", ")})
           VALUES (${placeholders.join(", ")})
           ON CONFLICT (id) DO UPDATE SET ${updates}`,
          values
        );
      }
    });

    return jsonNoStore({ success: true });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith("Missing server environment variable:");
    console.error("[api/functions/admin-save-sessions] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس جلسات تنظیم نشده است" : "خطا در ذخیره‌ی جلسات" },
      missingConfig ? 503 : 500
    );
  }
}
