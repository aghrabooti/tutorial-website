// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// get-my-courses
// ورودی:  { token }
// خروجی: { success, courses: [{ courses: {...} }] }
//   فرمت خروجی عمداً مثل جواب قبلی است؛ dashboard.js با item.courses کار می‌کند.
// منبع: سفارش‌های paid کاربر در جدول orders.
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

    if (!token) return jsonResponse({ error: "توکن ارسال نشده" }, 400);

    const user = await getSessionUser(token);
    if (!user) return jsonResponse({ error: "نشست معتبر نیست" }, 401);

    // همه‌ی دوره‌های خریداری‌شده از روی سفارش‌های موفق
    const { data: paidOrders } = await supabaseAdmin
      .from("orders")
      .select("course_ids")
      .eq("user_id", String(user.id))
      .eq("status", "paid");

    const ids = [
      ...new Set(
        (paidOrders ?? []).flatMap((o: any) => o.course_ids ?? [])
      ),
    ];

    if (ids.length === 0) {
      return jsonResponse({ success: true, courses: [] });
    }

    const { data: courses, error } = await supabaseAdmin
      .from("courses")
      .select("*")
      .in("id", ids);

    if (error) {
      console.error(error);
      return jsonResponse({ error: "خطا در دریافت دوره‌ها" }, 500);
    }

    // سازگار با فرمت قبلی: هر آیتم یک فیلد courses دارد
    const items = (courses ?? []).map((c: any) => ({ courses: c }));

    return jsonResponse({ success: true, courses: items });
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
