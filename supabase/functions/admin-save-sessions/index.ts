// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// admin-save-sessions — ذخیره‌ی جلسات یک دوره (فقط نقش admin)
// ورودی: {
//   token, course_id,
//   sessions: [{
//     id?,                // برای ویرایش جلسه‌ی موجود
//     session_number, title,
//     video_url?,         // لینک ویدیوی جلسه‌ی ضبط‌شده
//     is_online?,         // جلسه‌ی آنلاین (کلاس زنده)
//     online_url?,        // لینک ورود به کلاس آنلاین
//     scheduled_at?       // زمان شروع کلاس (ISO)
//   }]
// }
//   جلسه‌هایی که در فهرست نیستند ولی در دیتابیس هستند حذف می‌شوند.
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

async function hashText(text: string) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getAdminUser(token: string) {
  const tokenHash = await hashText(token);

  const { data: session } = await supabaseAdmin
    .from("user_sessions")
    .select("*")
    .eq("token_hash", tokenHash)
    .eq("is_active", true)
    .maybeSingle();

  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) return null;

  const { data: user } = await supabaseAdmin
    .from("site_users")
    .select("id, role")
    .eq("id", session.user_id)
    .maybeSingle();

  if (!user || user.role !== "admin") return null;
  return user;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { token, course_id, sessions } = await req.json();

    if (!token) return jsonResponse({ error: "توکن ارسال نشده" }, 401);

    const admin = await getAdminUser(token);
    if (!admin) return jsonResponse({ error: "دسترسی غیرمجاز — فقط مدیر" }, 403);

    if (!course_id)
      return jsonResponse({ error: "شناسه‌ی دوره ارسال نشده" }, 400);

    if (!Array.isArray(sessions))
      return jsonResponse({ error: "فهرست جلسات نامعتبر است" }, 400);

    // پاک‌سازی ورودی
    const rows = sessions.map((s: any) => ({
      ...(s.id ? { id: s.id } : {}),
      course_id,
      session_number: Number(s.session_number),
      title: String(s.title ?? "").trim(),
      video_url: s.video_url ? String(s.video_url).trim() : null,
      is_online: Boolean(s.is_online),
      online_url:
        s.is_online && s.online_url ? String(s.online_url).trim() : null,
      scheduled_at:
        s.is_online && s.scheduled_at ? String(s.scheduled_at) : null,
    }));

    for (const r of rows) {
      if (!Number.isFinite(r.session_number) || !r.title) {
        return jsonResponse(
          { error: "هر جلسه باید شماره و عنوان داشته باشد" },
          400
        );
      }
    }

    // ۱) حذف جلسه‌هایی که از فهرست حذف شده‌اند
    const { data: existing } = await supabaseAdmin
      .from("course_sessions")
      .select("id")
      .eq("course_id", course_id);

    const keepIds = new Set(
      rows.filter((r: any) => r.id).map((r: any) => String(r.id))
    );

    const toDelete = (existing ?? [])
      .map((e: any) => String(e.id))
      .filter((id: string) => !keepIds.has(id));

    if (toDelete.length > 0) {
      const { error: delErr } = await supabaseAdmin
        .from("course_sessions")
        .delete()
        .in("id", toDelete);

      if (delErr) {
        console.error(delErr);
        return jsonResponse({ error: "خطا در حذف جلسات قدیمی" }, 500);
      }
    }

    // ۲) درج/به‌روزرسانی
    if (rows.length > 0) {
      const { error: upErr } = await supabaseAdmin
        .from("course_sessions")
        .upsert(rows);

      if (upErr) {
        console.error(upErr);
        return jsonResponse({ error: "خطا در ذخیره‌ی جلسات" }, 500);
      }
    }

    return jsonResponse({ success: true });
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
