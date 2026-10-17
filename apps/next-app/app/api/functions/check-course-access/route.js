import { query } from "../../../../lib/postgres.js";
import { findActivePostgresSessionUser, isValidSessionToken, jsonNoStore } from "../../../../lib/session-token.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "درخواست نامعتبر است" }, 400);
  }

  const token = body?.token;
  const courseId = body?.course_id;
  if (!isValidSessionToken(token) || !courseId) {
    return jsonNoStore({ error: "اطلاعات ناقص است" }, 400);
  }

  try {
    const sessionResult = await findActivePostgresSessionUser(token, ["id", "phone", "first_name", "last_name"]);
    if (sessionResult.error && !sessionResult.expired) throw sessionResult.error;
    if (!sessionResult.session || !sessionResult.user) {
      return jsonNoStore({ error: "نشست معتبر نیست" }, 401);
    }
    if (sessionResult.userError) throw sessionResult.userError;

    const { rows: courses } = await query(
      "SELECT * FROM public.courses WHERE id = $1 LIMIT 1",
      [courseId]
    );
    const course = courses[0];
    if (!course) return jsonNoStore({ error: "دوره پیدا نشد" }, 404);

    const { rows: paid } = await query(
      `SELECT 1 AS owned
       FROM public.orders
       WHERE user_id = $1
         AND status = 'paid'
         AND $2 = ANY(course_ids)
       LIMIT 1`,
      [String(sessionResult.user.id), String(course.id)]
    );

    return jsonNoStore({
      success: true,
      purchased: paid.length > 0,
      course,
    });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/check-course-access] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس دسترسی دوره تنظیم نشده است" : "خطا در بررسی دسترسی دوره" },
      missingConfig ? 503 : 500
    );
  }
}
