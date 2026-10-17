import { withTransaction } from "../../../../lib/postgres.js";
import { findActivePostgresSessionUser, isValidSessionToken, jsonNoStore } from "../../../../lib/session-token.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ success: false, error: "invalid request body" }, 400);
  }

  const token = body?.token;
  const courseId = body?.course_id;
  if (!isValidSessionToken(token) || !courseId) {
    return jsonNoStore({ success: false, error: "missing data" }, 400);
  }

  try {
    const sessionResult = await findActivePostgresSessionUser(token);
    if (sessionResult.error && !sessionResult.expired) throw sessionResult.error;
    if (!sessionResult.session) {
      return jsonNoStore(
        { success: false, error: sessionResult.expired ? "session expired" : "invalid session" },
        401
      );
    }
    if (sessionResult.userError) throw sessionResult.userError;
    if (!sessionResult.user) return jsonNoStore({ success: false, error: "user not found" }, 404);

    const result = await withTransaction(async (client) => {
      const { rows: courses } = await client.query(
        "SELECT id FROM public.courses WHERE id = $1 LIMIT 1",
        [courseId]
      );
      if (courses.length === 0) return { status: 404, body: { success: false, error: "course not found" } };

      const { rows: purchases } = await client.query(
        `SELECT (
           EXISTS (
             SELECT 1 FROM public.user_purchases
             WHERE user_id = $1 AND course_id = $2
           ) OR EXISTS (
             SELECT 1 FROM public.orders
             WHERE user_id = $1 AND status = 'paid' AND $2 = ANY(course_ids)
           )
         ) AS purchased`,
        [String(sessionResult.user.id), String(courseId)]
      );
      if (purchases[0]?.purchased) {
        return { status: 409, body: { success: false, error: "already purchased" } };
      }

      const { rows: inserted } = await client.query(
        `INSERT INTO public.cart_items (user_id, course_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, course_id) DO NOTHING
         RETURNING id`,
        [sessionResult.user.id, courseId]
      );
      return inserted.length > 0
        ? { status: 200, body: { success: true, message: "added to cart" } }
        : { status: 200, body: { success: true, message: "already in cart" } };
    });

    return jsonNoStore(result.body, result.status);
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/add-to-cart] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      {
        success: false,
        error: missingConfig ? "Cart service is not configured" : error?.message ?? "Server error",
      },
      missingConfig ? 503 : 500
    );
  }
}
