// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// admin-shipments — مدیریت مرسوله‌های پستی (فقط نقش admin)
// ورودی:
//   { token, action: "list" }                              → فهرست مرسوله‌ها
//   { token, action: "mark_sent", shipment_id, tracking_code? } → ثبت ارسال
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
    const body = await req.json();
    const { token } = body;
    const action = body.action ?? "list";

    if (!token) return jsonResponse({ error: "توکن ارسال نشده" }, 401);

    const admin = await getAdminUser(token);
    if (!admin) return jsonResponse({ error: "دسترسی غیرمجاز — فقط مدیر" }, 403);

    // ── ثبت ارسال مرسوله ──
    if (action === "mark_sent") {
      const { shipment_id, tracking_code } = body;

      if (!shipment_id)
        return jsonResponse({ error: "شناسه‌ی مرسوله ارسال نشده" }, 400);

      const { error } = await supabaseAdmin
        .from("shipments")
        .update({
          status: "sent",
          tracking_code: String(tracking_code ?? "").trim() || null,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", shipment_id);

      if (error) {
        console.error(error);
        return jsonResponse({ error: "خطا در ثبت ارسال" }, 500);
      }

      return jsonResponse({ success: true });
    }

    // ── فهرست مرسوله‌ها ──
    const { data: shipments, error } = await supabaseAdmin
      .from("shipments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error(error);
      return jsonResponse({ error: "خطا در خواندن مرسوله‌ها" }, 500);
    }

    // اقلام هر سفارش برای نمایش
    const orderIds = [...new Set((shipments ?? []).map((s: any) => s.order_id))];

    let ordersById: Record<string, any> = {};
    if (orderIds.length > 0) {
      const { data: orders } = await supabaseAdmin
        .from("orders")
        .select("id, amount_rial, items")
        .in("id", orderIds);

      ordersById = Object.fromEntries(
        (orders ?? []).map((o: any) => [String(o.id), o])
      );
    }

    const rows = (shipments ?? []).map((s: any) => {
      const o = ordersById[String(s.order_id)] ?? {};
      return {
        id: s.id,
        status: s.status ?? "pending",
        tracking_code: s.tracking_code ?? null,
        full_name: s.full_name,
        phone: s.phone,
        province: s.province,
        city: s.city,
        address: s.address,
        postal_code: s.postal_code,
        created_at: s.created_at,
        sent_at: s.sent_at ?? null,
        amount_rial: o.amount_rial ?? null,
        items: Array.isArray(o.items)
          ? o.items.map((i: any) => i.title).filter(Boolean)
          : [],
      };
    });

    return jsonResponse({ success: true, shipments: rows });
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
