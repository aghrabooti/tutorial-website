import { createServiceSupabaseClient } from "../../../../lib/supabase-server.js";
import { jsonNoStore, isValidSessionToken } from "../../../../lib/session-token.js";
import { findActiveSessionUser } from "../../../../lib/session-user.js";

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
    const supabase = createServiceSupabaseClient();
    const sessionResult = await findActiveSessionUser(
      supabase,
      token,
      "id, phone, first_name, last_name"
    );
    if (!sessionResult.session || !sessionResult.user) {
      return jsonNoStore({ error: "نشست معتبر نیست" }, 401);
    }

    const { data: course } = await supabase
      .from("courses")
      .select("*")
      .eq("id", courseId)
      .maybeSingle();

    if (!course) {
      return jsonNoStore({ error: "دوره پیدا نشد" }, 404);
    }

    const { data: paid } = await supabase
      .from("orders")
      .select("id")
      .eq("user_id", String(sessionResult.user.id))
      .eq("status", "paid")
      .overlaps("course_ids", [String(course.id)])
      .limit(1);

    return jsonNoStore({
      success: true,
      purchased: (paid ?? []).length > 0,
      course,
    });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/check-course-access] Request failed:", error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس دسترسی دوره تنظیم نشده است" : error?.message ?? "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
