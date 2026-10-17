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
  if (!isValidSessionToken(token)) {
    return jsonNoStore({ error: "توکن ارسال نشده" }, 400);
  }

  try {
    const sessionResult = await findActivePostgresSessionUser(token);
    if (sessionResult.error && !sessionResult.expired) throw sessionResult.error;
    if (!sessionResult.session || !sessionResult.user) {
      return jsonNoStore({ error: "نشست معتبر نیست" }, 401);
    }
    if (sessionResult.userError) throw sessionResult.userError;

    const { rows: paidOrders } = await query(
      `SELECT course_ids
       FROM public.orders
       WHERE user_id = $1 AND status = 'paid'`,
      [String(sessionResult.user.id)]
    );

    const ids = [
      ...new Set(paidOrders.flatMap((order) =>
        Array.isArray(order.course_ids) ? order.course_ids.map(String) : []
      )),
    ];
    if (ids.length === 0) return jsonNoStore({ success: true, courses: [] });

    const { rows: courses } = await query(
      "SELECT * FROM public.courses WHERE id::text = ANY($1::text[])",
      [ids]
    );
    const coursesById = new Map(courses.map((course) => [String(course.id), course]));
    const items = ids
      .map((id) => coursesById.get(id))
      .filter(Boolean)
      .map((course) => ({ courses: course }));

    return jsonNoStore({ success: true, courses: items });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/get-my-courses] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس دوره‌ها تنظیم نشده است" : "خطا در دریافت دوره‌ها" },
      missingConfig ? 503 : 500
    );
  }
}
