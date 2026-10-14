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
  const courseId = body?.course_id;
  if (!isValidSessionToken(token)) return jsonNoStore({ error: "توکن ارسال نشده" }, 401);

  try {
    const supabase = createServiceSupabaseClient();
    const auth = await findActiveAdmin(supabase, token);
    if (!auth.session) return jsonNoStore({ error: "دسترسی غیرمجاز — فقط مدیر" }, 403);
    if (!auth.admin) return jsonNoStore({ error: "دسترسی غیرمجاز — فقط مدیر" }, 403);
    if (!courseId) return jsonNoStore({ error: "شناسه‌ی دوره ارسال نشده" }, 400);

    const { data: sessions, error } = await supabase
      .from("course_sessions")
      .select("*")
      .eq("course_id", courseId)
      .order("session_number", { ascending: true });

    if (error) {
      console.error("[api/functions/admin-get-sessions] Session lookup failed:", error);
      return jsonNoStore({ error: "خطا در خواندن جلسات" }, 500);
    }

    return jsonNoStore({ success: true, sessions: sessions ?? [] });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/admin-get-sessions] Request failed:", error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس جلسات تنظیم نشده است" : error?.message ?? "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
