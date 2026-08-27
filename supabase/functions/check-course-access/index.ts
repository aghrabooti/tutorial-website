// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// check-course-access
// ورودی:  { token, course_id }
// خروجی: { success, purchased, course }
// منبع حقیقت مالکیت: جدول orders — رکوردی با status='paid' که course_ids‌اش
// شامل این دوره باشد. (جدول جداگانه‌ای برای خرید وجود ندارد.)
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
    .select("id, phone, first_name, last_name")
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

    if (!token || !course_id)
      return jsonResponse({ error: "اطلاعات ناقص است" }, 400);

    const user = await getSessionUser(token);
    if (!user) return jsonResponse({ error: "نشست معتبر نیست" }, 401);

    const { data: course } = await supabaseAdmin
      .from("courses")
      .select("*")
      .eq("id", course_id)
      .maybeSingle();

    if (!course) return jsonResponse({ error: "دوره پیدا نشد" }, 404);

    // آیا سفارش پرداخت‌شده‌ای حاوی این دوره هست؟
    const { data: paid } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("user_id", String(user.id))
      .eq("status", "paid")
      .overlaps("course_ids", [String(course.id)])
      .limit(1);

    return jsonResponse({
      success: true,
      purchased: (paid ?? []).length > 0,
      course,
    });
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
