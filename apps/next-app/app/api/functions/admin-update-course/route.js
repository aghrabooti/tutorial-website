import { createServiceSupabaseClient } from "../../../../lib/supabase-server.js";
import { jsonNoStore, isValidSessionToken } from "../../../../lib/session-token.js";
import { findActiveAdmin } from "../../../../lib/admin-auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const editableFields = [
  "title",
  "grade",
  "category",
  "type",
  "description",
  "price",
  "discount_price",
  "image_url",
  "major",
];

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
    const supabase = createServiceSupabaseClient();
    const auth = await findActiveAdmin(supabase, token);
    if (!auth.session) return jsonNoStore({ success: false, error: "جلسه معتبر نیست" }, 401);
    if (!auth.admin) return jsonNoStore({ success: false, error: "دسترسی غیر مجاز" }, 403);

    const updateData = {};
    for (const field of editableFields) {
      if (Object.hasOwn(body, field)) {
        updateData[field] = body[field] === "" ? null : body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return jsonNoStore({ success: false, error: "هیچ تغییری ارسال نشده" }, 400);
    }

    const { error } = await supabase.from("courses").update(updateData).eq("id", courseId);
    if (error) {
      console.error("[api/functions/admin-update-course] Course update failed:", error);
      return jsonNoStore({ success: false, error: error.message }, 500);
    }

    return jsonNoStore({ success: true, message: "دوره با موفقیت بروزرسانی شد" });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/admin-update-course] Request failed:", error);
    return jsonNoStore(
      {
        success: false,
        error: missingConfig ? "سرویس دوره‌ها تنظیم نشده است" : error?.message ?? "خطای داخلی سرور",
      },
      missingConfig ? 503 : 500
    );
  }
}
