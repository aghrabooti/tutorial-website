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
    const supabase = createServiceSupabaseClient();
    const auth = await findActiveAdmin(supabase, token);
    if (!auth.session) return jsonNoStore({ success: false, error: "جلسه معتبر نیست" }, 401);
    if (!auth.admin) return jsonNoStore({ success: false, error: "دسترسی غیرمجاز" }, 403);

    const { data: course, error } = await supabase
      .from("courses")
      .insert({
        title,
        grade: grade || null,
        category: category || null,
        type,
        description: description || null,
        price: price ? Number(price) : null,
        discount_price: discount_price ? Number(discount_price) : null,
        image_url: image_url || null,
        major: major || null,
      })
      .select()
      .single();

    if (error) {
      console.error("[api/functions/admin-create-course] Course insert failed:", error);
      return jsonNoStore({ success: false, error: error.message }, 500);
    }

    return jsonNoStore({ success: true, course, message: "محتوا ساخته شد" });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/admin-create-course] Request failed:", error);
    return jsonNoStore(
      {
        success: false,
        error: missingConfig ? "سرویس دوره‌ها تنظیم نشده است" : error?.message ?? "خطای داخلی",
      },
      missingConfig ? 503 : 500
    );
  }
}
