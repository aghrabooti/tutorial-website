// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// get-course-file
// ورودی: { token, course_id }
// خروجی: { success, url } — لینکِ موقتِ امضاشده (۵ دقیقه) برای دانلود PDF
//   فقط خریداران محصول (سفارش paid که course_ids آن شامل این دوره است)
//   می‌توانند لینک بگیرند؛ باکت خصوصی است و هیچ URL عمومی‌ای وجود ندارد.
// قرارداد نام‌گذاری فایل‌ها در استوریج:
//   course-files/<course_id>.pdf
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ⚠️ نام باکت خصوصی فایل‌ها:
const BUCKET = "course-files";

// مدت اعتبار لینک دانلود (ثانیه)
const URL_TTL = 300;

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

// همان منطق بقیه توابع: توکن → کاربر
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

    // ۱) مالکیت: سفارش paid شامل این دوره (منبع حقیقت: جدول orders)
    const { data: paidOrders } = await supabaseAdmin
      .from("orders")
      .select("course_ids")
      .eq("user_id", String(user.id))
      .eq("status", "paid");

    const owned = new Set(
      (paidOrders ?? []).flatMap((o: any) => o.course_ids ?? [])
    );

    if (!owned.has(String(course_id))) {
      return jsonResponse({ error: "این فایل فقط برای خریداران فعال است" }, 403);
    }

    // ۲) ساخت لینک موقت برای فایل
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(`${course_id}.pdf`, URL_TTL);

    if (error || !data?.signedUrl) {
      console.error(error);
      return jsonResponse(
        { error: "فایل این محصول هنوز بارگذاری نشده است" },
        404
      );
    }

    return jsonResponse({ success: true, url: data.signedUrl });
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
