// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// admin-users — فهرست کاربران سایت (فقط نقش admin)
// ورودی: { token }
// خروجی: { success, users: [ { id, phone, first_name, last_name, role } ] }
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
    const { token } = await req.json();

    if (!token) return jsonResponse({ error: "توکن ارسال نشده" }, 401);

    const admin = await getAdminUser(token);
    if (!admin) return jsonResponse({ error: "دسترسی غیرمجاز — فقط مدیر" }, 403);

    const { data: users, error } = await supabaseAdmin
      .from("site_users")
      .select("id, phone, first_name, last_name, role")
      .limit(300);

    if (error) {
      console.error(error);
      return jsonResponse({ error: "خطا در خواندن کاربران" }, 500);
    }

    return jsonResponse({ success: true, users: users ?? [] });
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
