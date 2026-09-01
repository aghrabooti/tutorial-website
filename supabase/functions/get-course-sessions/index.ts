// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// get-course-sessions — جلسات یک دوره برای خریداران
// ورودی: { token, course_id }
// خروجی: { success, sessions: [...], server_now }
//
//   جلسه‌ی آنلاین (is_online): لینک ورود (online_url) فقط از ۵ دقیقه قبل از
//   شروع کلاس در پاسخ قرار می‌گیرد؛ قبل از آن online_url=null است و
//   online_available=false برمی‌گردد. بنابراین لینک کلاس هرگز زودتر «به دست»
//   مرورگر نمی‌رسد — فقط در پنجره‌ی مجاز ساخته می‌شود.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

// چند دقیقه قبل از شروع، لینک فعال شود
const EARLY_MINUTES = 5;

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
    const { token, course_id } = await req.json();

    if (!token) return jsonResponse({ error: "توکن ارسال نشده" }, 401);
    if (!course_id)
      return jsonResponse({ error: "شناسه‌ی دوره ارسال نشده" }, 400);

    const user = await getSessionUser(token);
    if (!user) return jsonResponse({ error: "نشست معتبر نیست" }, 401);

    // ۱) مالکیت: سفارش paid شامل این دوره
    const { data: paidOrders } = await supabaseAdmin
      .from("orders")
      .select("course_ids")
      .eq("user_id", String(user.id))
      .eq("status", "paid");

    const owned = new Set(
      (paidOrders ?? []).flatMap((o: any) => o.course_ids ?? [])
    );

    if (!owned.has(String(course_id))) {
      return jsonResponse({ error: "دسترسی فقط برای خریداران است" }, 403);
    }

    // ۲) جلسات
    const { data: sessions, error } = await supabaseAdmin
      .from("course_sessions")
      .select("*")
      .eq("course_id", course_id)
      .order("session_number", { ascending: true });

    if (error) {
      console.error(error);
      return jsonResponse({ error: "خطا در خواندن جلسات" }, 500);
    }

    // ۳) قفل زمانی لینک کلاس آنلاین
    const now = Date.now();
    const EARLY_MS = EARLY_MINUTES * 60 * 1000;

    const out = (sessions ?? []).map((s: any) => {
      if (!s.is_online) {
        return { ...s, online_available: true };
      }

      const start = s.scheduled_at ? new Date(s.scheduled_at).getTime() : null;
      const available = start != null && now >= start - EARLY_MS;

      return {
        ...s,
        online_url: available ? s.online_url : null,
        online_available: available,
      };
    });

    return jsonResponse({
      success: true,
      sessions: out,
      server_now: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
