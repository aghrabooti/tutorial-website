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
    return jsonNoStore({ success: false, error: "درخواست نامعتبر است" }, 400);
  }

  const { token, title, grade, category, type, description, price, discount_price, image_url, major } = body ?? {};
  if (!isValidSessionToken(token)) {
    return jsonNoStore({ success: false, error: "توکن ارسال نشده" }, 400);
  }
  if (!title || !type) {
    return jsonNoStore({ success: false, error: "عنوان و نوع محتوا الزامی است" }, 400);
  }

  try {
    const auth = await findActivePostgresAdmin(token);
    if (auth.error && !auth.expired) throw auth.error;
    if (auth.userError) throw auth.userError;
    if (!auth.session) return jsonNoStore({ success: false, error: "جلسه معتبر نیست" }, 401);
    if (!auth.admin) return jsonNoStore({ success: false, error: "دسترسی غیرمجاز" }, 403);

    const values = [
      title,
      grade || null,
      category || null,
      type,
      description || null,
      price ? Number(price) : null,
      discount_price ? Number(discount_price) : null,
      image_url || null,
      major || null,
    ];
    const { rows } = await query(
      `INSERT INTO public.courses
         (title, grade, category, type, description, price, discount_price, image_url, major)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      values
    );

    return jsonNoStore({ success: true, course: rows[0], message: "محتوا ساخته شد" });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith("Missing server environment variable:");
    console.error("[api/functions/admin-create-course] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      {
        success: false,
        error: missingConfig ? "سرویس دوره‌ها تنظیم نشده است" : error?.message ?? "خطای داخلی",
      },
      missingConfig ? 503 : 500
    );
  }
}
