// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// change-password
// ورودی: { token, current_password, new_password }
//   رمز فعلی را با همان الگوریتم login-user بررسی می‌کند (PBKDF2-SHA256،
//   قالب salt:hash) و در صورت درست‌بودن، رمز جدید را ذخیره می‌کند.
//   بعد از تغییر رمز، همه‌ی نشست‌های دیگر کاربر غیرفعال می‌شوند.
// خروجی: { success: true }
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── همان الگوریتم register-user ──
async function hashPassword(password: string) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256
  );

  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const hashHex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `${saltHex}:${hashHex}`;
}

// ── همان الگوریتم login-user ──
async function verifyPassword(password: string, storedHash: string) {
  const parts = String(storedHash ?? "").split(":");
  if (parts.length !== 2) return false;

  const saltBytes = parts[0].match(/.{1,2}/g);
  if (!saltBytes) return false;

  const salt = new Uint8Array(saltBytes.map((byte) => parseInt(byte, 16)));
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256
  );

  const hashHex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return hashHex === parts[1];
}

async function hashText(text: string) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { token, current_password, new_password } = await req.json();

    if (!token) return jsonResponse({ error: "توکن ارسال نشده" }, 401);
    if (!current_password || !new_password)
      return jsonResponse({ error: "رمز فعلی و جدید هر دو لازم است" }, 400);
    if (String(new_password).length < 8)
      return jsonResponse({ error: "رمز جدید باید حداقل ۸ کاراکتر باشد" }, 400);

    // ۱) نشست معتبر
    const tokenHash = await hashText(token);

    const { data: session } = await supabaseAdmin
      .from("user_sessions")
      .select("*")
      .eq("token_hash", tokenHash)
      .eq("is_active", true)
      .maybeSingle();

    if (!session) return jsonResponse({ error: "نشست معتبر نیست" }, 401);

    if (new Date(session.expires_at) < new Date()) {
      await supabaseAdmin
        .from("user_sessions")
        .update({ is_active: false })
        .eq("id", session.id);
      return jsonResponse({ error: "نشست منقضی شده است" }, 401);
    }

    // ۲) کاربر + رمز فعلی
    const { data: user } = await supabaseAdmin
      .from("site_users")
      .select("id, password_hash")
      .eq("id", session.user_id)
      .maybeSingle();

    if (!user) return jsonResponse({ error: "کاربر پیدا نشد" }, 404);

    const ok = await verifyPassword(current_password, user.password_hash);
    if (!ok)
      return jsonResponse({ error: "رمز عبور فعلی اشتباه است" }, 403);

    // ۳) ذخیره‌ی رمز جدید
    const newHash = await hashPassword(new_password);

    const { error: upErr } = await supabaseAdmin
      .from("site_users")
      .update({ password_hash: newHash })
      .eq("id", user.id);

    if (upErr) {
      console.error(upErr);
      return jsonResponse({ error: "خطا در ذخیره‌ی رمز جدید" }, 500);
    }

    // ۴) غیرفعال کردن همه‌ی نشست‌های دیگر (امنیت)
    await supabaseAdmin
      .from("user_sessions")
      .update({ is_active: false })
      .eq("user_id", user.id)
      .neq("id", session.id);

    return jsonResponse({ success: true });
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
