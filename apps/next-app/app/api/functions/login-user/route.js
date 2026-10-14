import { randomUUID } from "node:crypto";
import { createServiceSupabaseClient } from "../../../../lib/supabase-server.js";
import { hashSessionToken, jsonNoStore } from "../../../../lib/session-token.js";
import { verifyPassword } from "../../../../lib/password-hash.js";
import { normalizePhone } from "../../../../lib/phone.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "درخواست نامعتبر است" }, 400);
  }

  const { phone, password } = body ?? {};
  if (typeof phone !== "string" || !phone.trim() || typeof password !== "string" || !password) {
    return jsonNoStore({ error: "اطلاعات ناقص است" }, 400);
  }

  try {
    const supabase = createServiceSupabaseClient();
    const normalizedPhone = normalizePhone(phone);
    const { data: user, error: userError } = await supabase
      .from("site_users")
      .select("*")
      .eq("phone", normalizedPhone)
      .maybeSingle();

    if (userError || !user) {
      return jsonNoStore({ error: "شماره یا رمز اشتباه است" }, 401);
    }

    if (!user.is_active) {
      return jsonNoStore({ error: "حساب کاربری غیرفعال است" }, 403);
    }

    if (!(await verifyPassword(password, user.password_hash))) {
      return jsonNoStore({ error: "شماره یا رمز اشتباه است" }, 401);
    }

    const token = randomUUID() + randomUUID();
    const tokenHash = hashSessionToken(token);
    const { error: sessionError } = await supabase.from("user_sessions").insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    if (sessionError) {
      console.error("[api/functions/login-user] Session creation failed:", sessionError);
      return jsonNoStore({ error: "خطا در ساخت نشست" }, 500);
    }

    // Preserve the old behavior: a failed last_login update does not fail login.
    await supabase
      .from("site_users")
      .update({ last_login: new Date() })
      .eq("id", user.id);

    return jsonNoStore({
      success: true,
      token,
      user: {
        id: user.id,
        phone: user.phone,
        first_name: user.first_name,
        last_name: user.last_name,
        grade: user.grade,
        major: user.major,
        role: user.role,
      },
    });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/login-user] Request failed:", error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس ورود تنظیم نشده است" : "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
