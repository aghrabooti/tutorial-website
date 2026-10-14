import { createServiceSupabaseClient } from "../../../../lib/supabase-server.js";
import { hashPassword } from "../../../../lib/password-hash.js";
import { jsonNoStore } from "../../../../lib/session-token.js";
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

  const { phone, password, first_name, last_name } = body ?? {};
  if (typeof phone !== "string" || !phone.trim() || typeof password !== "string" || !password) {
    return jsonNoStore({ error: "اطلاعات ناقص است" }, 400);
  }

  if (password.length < 6) {
    return jsonNoStore({ error: "رمز باید حداقل ۶ کاراکتر باشد" }, 400);
  }

  try {
    const supabase = createServiceSupabaseClient();
    const normalizedPhone = normalizePhone(phone);
    const { data: existingUser } = await supabase
      .from("site_users")
      .select("id")
      .eq("phone", normalizedPhone)
      .maybeSingle();

    if (existingUser) {
      return jsonNoStore({ error: "این شماره قبلاً ثبت شده است" }, 409);
    }

    const passwordHash = await hashPassword(password);
    const { data: user, error } = await supabase
      .from("site_users")
      .insert({
        phone: normalizedPhone,
        password_hash: passwordHash,
        first_name: String(first_name ?? "").trim(),
        last_name: String(last_name ?? "").trim(),
        role: "student",
      })
      .select()
      .single();

    if (error) {
      console.error("[api/functions/register-user] User creation failed:", error);
      return jsonNoStore({ error: "خطا در ساخت کاربر" }, 500);
    }

    return jsonNoStore({
      success: true,
      user: {
        id: user.id,
        phone: user.phone,
        full_name: user.full_name,
      },
    });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/register-user] Request failed:", error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس ثبت‌نام تنظیم نشده است" : "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
