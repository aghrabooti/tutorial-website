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
  if (!isValidSessionToken(token)) {
    return jsonNoStore({ error: "توکن ارسال نشده" }, 400);
  }

  try {
    const supabase = createServiceSupabaseClient();
    const sessionResult = await findActiveSessionUser(supabase, token);
    if (!sessionResult.session || !sessionResult.user) {
      return jsonNoStore({ error: "نشست معتبر نیست" }, 401);
    }

    const { data: paidOrders } = await supabase
      .from("orders")
      .select("course_ids")
      .eq("user_id", String(sessionResult.user.id))
      .eq("status", "paid");

    const ids = [
      ...new Set((paidOrders ?? []).flatMap((order) => order.course_ids ?? [])),
    ];
    if (ids.length === 0) {
      return jsonNoStore({ success: true, courses: [] });
    }

    const { data: courses, error } = await supabase
      .from("courses")
      .select("*")
      .in("id", ids);

    if (error) {
      console.error("[api/functions/get-my-courses] Course lookup failed:", error);
      return jsonNoStore({ error: "خطا در دریافت دوره‌ها" }, 500);
    }

    const items = (courses ?? []).map((course) => ({ courses: course }));
    return jsonNoStore({ success: true, courses: items });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/get-my-courses] Request failed:", error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس دوره‌ها تنظیم نشده است" : error?.message ?? "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
