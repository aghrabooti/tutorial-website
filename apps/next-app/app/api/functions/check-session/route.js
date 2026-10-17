import { query } from "../../../../lib/postgres.js";
import {
  findActivePostgresSession,
  isValidSessionToken,
  jsonNoStore,
} from "../../../../lib/session-token.js";

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
    const sessionResult = await findActivePostgresSession(token);
    const { session } = sessionResult;

    if (!session) {
      if (sessionResult.error && !sessionResult.expired) {
        console.error("[api/functions/check-session] PostgreSQL session lookup failed:", sessionResult.error?.message ?? sessionResult.error);
        return jsonNoStore({ error: "خطا در بررسی نشست" }, 500);
      }
      if (sessionResult.error) {
        console.error("[api/functions/check-session] Expired session cleanup failed:", sessionResult.error?.message ?? sessionResult.error);
      }
      return jsonNoStore(
        { error: sessionResult.expired ? "نشست منقضی شده" : "نشست معتبر نیست" },
        401
      );
    }

    const { rows } = await query(
      `SELECT id, phone, first_name, last_name, role
       FROM public.site_users
       WHERE id = $1
       LIMIT 1`,
      [session.user_id]
    );
    const user = rows[0] ?? null;
    if (!user) return jsonNoStore({ error: "کاربر پیدا نشد" }, 404);

    return jsonNoStore({ success: true, user });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/check-session] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس نشست تنظیم نشده است" : "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
