import { query } from "../../../../lib/postgres.js";
import { findActivePostgresAdmin } from "../../../../lib/admin-auth.js";
import { jsonNoStore, isValidSessionToken } from "../../../../lib/session-token.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const editableFields = new Set([
  "title",
  "grade",
  "category",
  "type",
  "description",
  "price",
  "discount_price",
  "image_url",
  "major",
]);

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ success: false, error: "درخواست نامعتبر است" }, 400);
  }

  const token = body?.token;
  const courseId = body?.course_id;
  if (!isValidSessionToken(token) || !courseId) {
    return jsonNoStore({ success: false, error: "اطلاعات ناقص است" }, 400);
  }

  try {
    const auth = await findActivePostgresAdmin(token);
    if (auth.error && !auth.expired) throw auth.error;
    if (auth.userError) throw auth.userError;
    if (!auth.session) return jsonNoStore({ success: false, error: "جلسه معتبر نیست" }, 401);
    if (!auth.admin) return jsonNoStore({ success: false, error: "دسترسی غیر مجاز" }, 403);

    const updates = Object.entries(body)
      .filter(([field]) => editableFields.has(field))
      .map(([field, value]) => [field, value === "" ? null : value]);
    if (updates.length === 0) {
      return jsonNoStore({ success: false, error: "هیچ تغییری ارسال نشده" }, 400);
    }

    const values = updates.map(([, value]) => value);
    values.push(courseId);
    const setClause = updates.map(([field], index) => `${field} = $${index + 1}`).join(", ");
    await query(
      `UPDATE public.courses SET ${setClause} WHERE id = $${values.length}`,
      values
    );

    return jsonNoStore({ success: true, message: "دوره با موفقیت بروزرسانی شد" });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith("Missing server environment variable:");
    console.error("[api/functions/admin-update-course] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      {
        success: false,
        error: missingConfig ? "سرویس دوره‌ها تنظیم نشده است" : error?.message ?? "خطای داخلی سرور",
      },
      missingConfig ? 503 : 500
    );
  }
}
