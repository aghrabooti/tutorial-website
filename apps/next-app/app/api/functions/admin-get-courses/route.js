import { createServiceSupabaseClient } from "../../../../lib/supabase-server.js";
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

  const token = body?.token;
  if (!isValidSessionToken(token)) return jsonNoStore({ error: "توکن ارسال نشده است" }, 401);

  try {
    const supabase = createServiceSupabaseClient();
    const auth = await findActiveAdmin(supabase, token);
    if (!auth.session) return jsonNoStore({ error: "سشن معتبر نیست" }, 401);
    if (!auth.admin) return jsonNoStore({ error: "دسترسی غیرمجاز" }, 403);

    const { data: courses, error } = await supabase.from("courses").select(`
      id,
      title,
      grade,
      major,
      category,
      type,
      description,
      price,
      discount_price,
      image_url
    `);

    if (error) {
      console.error("[api/functions/admin-get-courses] Course lookup failed:", error);
      return jsonNoStore({ error: "خطا در دریافت دوره‌ها" }, 500);
    }

    return jsonNoStore({ success: true, courses });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/admin-get-courses] Request failed:", error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس دوره‌ها تنظیم نشده است" : error?.message ?? "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
