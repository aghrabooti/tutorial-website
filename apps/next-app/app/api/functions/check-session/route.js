import { createServiceSupabaseClient } from "../../../../lib/supabase-server.js";
import {
  findActiveSession,
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
    const supabase = createServiceSupabaseClient();
    const sessionResult = await findActiveSession(supabase, token);
    const { session } = sessionResult;

    if (!session) {
      if (sessionResult.error) {
        console.error("[api/functions/check-session] Session lookup/cleanup failed:", sessionResult.error);
      }
      return jsonNoStore(
        { error: sessionResult.expired ? "نشست منقضی شده" : "نشست معتبر نیست" },
        401
      );
    }

    const { data: user, error: userError } = await supabase
      .from("site_users")
      .select("id,phone,first_name,last_name,role")
      .eq("id", session.user_id)
      .single();

    if (userError) {
      console.error("[api/functions/check-session] User lookup failed:", userError);
      return jsonNoStore({ error: "کاربر پیدا نشد" }, 404);
    }

    if (!user) {
      return jsonNoStore({ error: "کاربر پیدا نشد" }, 404);
    }

    return jsonNoStore({ success: true, user });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/check-session] Request failed:", error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس نشست تنظیم نشده است" : "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
