// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// admin-upload-url — مجوز آپلود مستقیم فایل به استوریج (فقط نقش admin)
// ورودی:
//   { token, kind: "pdf", course_id }            → لینک آپلود PDF محصول
//                                                  (مسیر: course-files/<course_id>.pdf)
//   { token, kind: "image", filename }           → لینک آپلود عکس دوره
//                                                  + public_url آماده برای فرم دوره
// مرورگر بعد از دریافت پاسخ، خودِ فایل را با PUT مستقیم به استوریج می‌فرستد.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FILES_BUCKET = "course-files";   // خصوصی — PDF جزوه/کتاب
const IMAGES_BUCKET = "course-images"; // عمومی — عکس کاور دوره‌ها

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
    const body = await req.json();
    const { token, kind } = body;

    if (!token) return jsonResponse({ error: "توکن ارسال نشده" }, 401);

    const admin = await getAdminUser(token);
    if (!admin) return jsonResponse({ error: "دسترسی غیرمجاز — فقط مدیر" }, 403);

    // ── PDF جزوه/کتاب ──
    if (kind === "pdf") {
      const { course_id } = body;

      if (!course_id)
        return jsonResponse({ error: "دوره انتخاب نشده است" }, 400);

      const path = `${course_id}.pdf`;

      const { data, error } = await supabaseAdmin.storage
        .from(FILES_BUCKET)
        .createSignedUploadUrl(path, { upsert: true });

      if (error || !data?.signedUrl) {
        console.error(error);
        return jsonResponse({ error: "خطا در ساخت لینک آپلود" }, 500);
      }

      return jsonResponse({ success: true, upload_url: data.signedUrl, path });
    }

    // ── عکس کاور دوره ──
    if (kind === "image") {
      const safe = String(body.filename ?? "image")
        .toLowerCase()
        .replace(/[^a-z0-9.\-_]/g, "-")
        .replace(/-+/g, "-");

      const path = `courses/${Date.now()}-${safe}`;

      const { data, error } = await supabaseAdmin.storage
        .from(IMAGES_BUCKET)
        .createSignedUploadUrl(path);

      if (error || !data?.signedUrl) {
        console.error(error);
        return jsonResponse({ error: "خطا در ساخت لینک آپلود" }, 500);
      }

      const public_url = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${IMAGES_BUCKET}/${path}`;

      return jsonResponse({
        success: true,
        upload_url: data.signedUrl,
        path,
        public_url,
      });
    }

    return jsonResponse({ error: "نوع آپلود نامعتبر است" }, 400);
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
