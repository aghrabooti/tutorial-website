import { createServiceSupabaseClient } from "../../../../lib/supabase-server.js";
import {
  hashSessionToken,
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
    const tokenHash = hashSessionToken(token);
    const { data: session, error: sessionError } = await supabase
      .from("user_sessions")
      .select("id")
      .eq("token_hash", tokenHash)
      .eq("is_active", true)
      .maybeSingle();

    if (sessionError || !session) {
      if (sessionError) {
        console.error("[api/functions/logout-user] Session lookup failed:", sessionError);
      }
      return jsonNoStore({ error: "Session پیدا نشد" }, 401);
    }

    const { error: updateError } = await supabase
      .from("user_sessions")
      .update({ is_active: false })
      .eq("id", session.id);

    if (updateError) {
      console.error("[api/functions/logout-user] Session logout failed:", updateError);
      return jsonNoStore({ error: "خطا در خروج" }, 500);
    }

    return jsonNoStore({ success: true, message: "با موفقیت خارج شدید" });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/logout-user] Request failed:", error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس نشست تنظیم نشده است" : "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
