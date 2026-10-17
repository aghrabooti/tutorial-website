import { query } from "../../../../lib/postgres.js";
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

  const token = body?.token;
  if (!isValidSessionToken(token)) return jsonNoStore({ error: "توکن ارسال نشده است" }, 401);

  try {
    const auth = await findActivePostgresAdmin(token);
    if (auth.error && !auth.expired) throw auth.error;
    if (auth.userError) throw auth.userError;
    if (!auth.session) return jsonNoStore({ error: "سشن معتبر نیست" }, 401);
    if (!auth.admin) return jsonNoStore({ error: "دسترسی غیرمجاز" }, 403);

    const { rows: courses } = await query(
      `SELECT id, title, grade, major, category, type, description, price,
              discount_price, image_url
       FROM public.courses`
    );
    return jsonNoStore({ success: true, courses });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith("Missing server environment variable:");
    console.error("[api/functions/admin-get-courses] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس دوره‌ها تنظیم نشده است" : "خطا در دریافت دوره‌ها" },
      missingConfig ? 503 : 500
    );
  }
}
