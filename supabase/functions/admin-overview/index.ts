// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// admin-overview — آمار کلی پنل مدیریت (فقط نقش admin)
// ورودی: { token }
// خروجی: { success, stats: { revenue_rial, paid_orders, users, pending_shipments } }
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

// توکن → کاربر admin (در غیر این صورت null)
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

    const usersRes = await supabaseAdmin
      .from("site_users")
      .select("id", { count: "exact", head: true });

    const paidRes = await supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "paid");

    const { data: paidOrders } = await supabaseAdmin
      .from("orders")
      .select("amount_rial")
      .eq("status", "paid");

    const revenueRial = (paidOrders ?? []).reduce(
      (sum: number, o: any) => sum + Number(o.amount_rial ?? 0),
      0
    );

    const shipRes = await supabaseAdmin
      .from("shipments")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    return jsonResponse({
      success: true,
      stats: {
        revenue_rial: revenueRial,
        paid_orders: paidRes.count ?? 0,
        users: usersRes.count ?? 0,
        pending_shipments: shipRes.error ? null : shipRes.count ?? 0,
      },
    });
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
