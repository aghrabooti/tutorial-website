// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// admin-get-sessions — فهرست کامل جلسات یک دوره برای ویرایش (فقط نقش admin)
// ورودی: { token, course_id }
// خروجی: { success, sessions: [...] }
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
    const { token, course_id } = await req.json();

    if (!token) return jsonResponse({ error: "توکن ارسال نشده" }, 401);

    const admin = await getAdminUser(token);
    if (!admin) return jsonResponse({ error: "دسترسی غیرمجاز — فقط مدیر" }, 403);

    if (!course_id)
      return jsonResponse({ error: "شناسه‌ی دوره ارسال نشده" }, 400);

    const { data: sessions, error } = await supabaseAdmin
      .from("course_sessions")
      .select("*")
      .eq("course_id", course_id)
      .order("session_number", { ascending: true });

    if (error) {
      console.error(error);
      return jsonResponse({ error: "خطا در خواندن جلسات" }, 500);
    }

    return jsonResponse({ success: true, sessions: sessions ?? [] });
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
