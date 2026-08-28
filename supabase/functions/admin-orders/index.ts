// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// admin-orders — فهرست سفارش‌ها (فقط نقش admin)
// ورودی: { token }
// خروجی: { success, orders: [ { id, created_at, status, source, amount_rial,
//          ref_id, user_name, user_phone, items: [عنوان‌ها] } ] }
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

    const { data: orders, error } = await supabaseAdmin
      .from("orders")
      .select("id, user_id, amount_rial, status, source, items, ref_id, created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error(error);
      return jsonResponse({ error: "خطا در خواندن سفارش‌ها" }, 500);
    }

    // اطلاعات مشتری‌ها
    const userIds = [...new Set((orders ?? []).map((o: any) => o.user_id))];

    let usersById: Record<string, any> = {};
    if (userIds.length > 0) {
      const { data: users } = await supabaseAdmin
        .from("site_users")
        .select("id, first_name, last_name, phone")
        .in("id", userIds);

      usersById = Object.fromEntries(
        (users ?? []).map((u: any) => [String(u.id), u])
      );
    }

    const rows = (orders ?? []).map((o: any) => {
      const u = usersById[String(o.user_id)] ?? {};
      return {
        id: o.id,
        created_at: o.created_at,
        status: o.status,
        source: o.source,
        amount_rial: o.amount_rial,
        ref_id: o.ref_id,
        user_name:
          [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || "—",
        user_phone: u.phone ?? "—",
        items: Array.isArray(o.items)
          ? o.items.map((i: any) => i.title).filter(Boolean)
          : [],
      };
    });

    return jsonResponse({ success: true, orders: rows });
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
