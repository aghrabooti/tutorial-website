// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// get-my-address
// ورودی: { token }
// خروجی: { success: true, address: { full_name, phone, province, city, address,
//          postal_code, updated_at } | null }
//   نشانی پستیِ ذخیره‌شده‌ی کاربر را برمی‌گرداند (برای پیش‌پر کردن فرم آدرس).
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

async function hashText(text: string) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getSessionUser(token: string) {
  const tokenHash = await hashText(token);

  const { data: session } = await supabaseAdmin
    .from("user_sessions")
    .select("*")
    .eq("token_hash", tokenHash)
    .eq("is_active", true)
    .maybeSingle();

  if (!session) return null;

  if (new Date(session.expires_at) < new Date()) {
    await supabaseAdmin
      .from("user_sessions")
      .update({ is_active: false })
      .eq("id", session.id);
    return null;
  }

  const { data: user } = await supabaseAdmin
    .from("site_users")
    .select("id")
    .eq("id", session.user_id)
    .maybeSingle();

  return user ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { token } = await req.json();

    if (!token) return jsonResponse({ error: "توکن ارسال نشده" }, 401);

    const user = await getSessionUser(token);
    if (!user) return jsonResponse({ error: "نشست معتبر نیست" }, 401);

    const { data: address, error } = await supabaseAdmin
      .from("user_addresses")
      .select("full_name, phone, province, city, address, postal_code, updated_at")
      .eq("user_id", String(user.id))
      .maybeSingle();

    if (error) {
      console.error(error);
      return jsonResponse({ error: "خطا در خواندن نشانی" }, 500);
    }

    return jsonResponse({ success: true, address: address ?? null });
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
