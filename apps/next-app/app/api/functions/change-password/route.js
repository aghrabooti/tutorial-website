import { createServiceSupabaseClient } from "../../../../lib/supabase-server.js";
import { hashPassword, verifyPassword } from "../../../../lib/password-hash.js";
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

  const { token, current_password: currentPassword, new_password: newPassword } = body ?? {};
  if (!isValidSessionToken(token)) {
    return jsonNoStore({ error: "توکن ارسال نشده" }, 401);
  }
  if (typeof currentPassword !== "string" || !currentPassword || typeof newPassword !== "string" || !newPassword) {
    return jsonNoStore({ error: "رمز فعلی و جدید هر دو لازم است" }, 400);
  }
  if (newPassword.length < 8) {
    return jsonNoStore({ error: "رمز جدید باید حداقل ۸ کاراکتر باشد" }, 400);
  }

  try {
    const supabase = createServiceSupabaseClient();
    const sessionResult = await findActiveSession(supabase, token);
    if (!sessionResult.session) {
      if (sessionResult.error && !sessionResult.expired) {
        console.error("[api/functions/change-password] Session lookup failed:", sessionResult.error);
        return jsonNoStore({ error: "خطا در بررسی نشست" }, 500);
      }
      if (sessionResult.error) {
        console.error("[api/functions/change-password] Expired session cleanup failed:", sessionResult.error);
      }
      return jsonNoStore(
        { error: sessionResult.expired ? "نشست منقضی شده است" : "نشست معتبر نیست" },
        401
      );
    }

    const { data: user } = await supabase
      .from("site_users")
      .select("id,password_hash")
      .eq("id", sessionResult.session.user_id)
      .maybeSingle();

    if (!user) {
      return jsonNoStore({ error: "کاربر پیدا نشد" }, 404);
    }

    if (!(await verifyPassword(currentPassword, user.password_hash))) {
      return jsonNoStore({ error: "رمز عبور فعلی اشتباه است" }, 403);
    }

    const newHash = await hashPassword(newPassword);
    const { error: updateError } = await supabase
      .from("site_users")
      .update({ password_hash: newHash })
      .eq("id", user.id);

    if (updateError) {
      console.error("[api/functions/change-password] Password update failed:", updateError);
      return jsonNoStore({ error: "خطا در ذخیره‌ی رمز جدید" }, 500);
    }

    // Preserve old behavior: a failure while revoking other sessions does not undo the password change.
    await supabase
      .from("user_sessions")
      .update({ is_active: false })
      .eq("user_id", user.id)
      .neq("id", sessionResult.session.id);

    return jsonNoStore({ success: true });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/change-password] Request failed:", error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس تغییر رمز تنظیم نشده است" : error?.message ?? "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
