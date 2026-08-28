// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// save-shipping-address
// ورودی: { token, order_id, full_name, phone, province, city, address, postal_code }
//   آدرس پستی را برای سفارشِ paid ثبت/به‌روز می‌کند — فقط اگر سفارش متعلق به
//   خود کاربر باشد و حداقل یکی از اقلامش محصول فیزیکی (requires_shipping) باشد.
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

// تبدیل ارقام فارسی/عربی به لاتین
function toLatinDigits(s: string) {
  return String(s ?? "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

async function hashText(text: string) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// همان منطق payment-request: توکن → کاربر
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
    const body = await req.json();
    const { token, order_id } = body;

    const full_name   = String(body.full_name ?? "").trim();
    const phone       = toLatinDigits(String(body.phone ?? "").trim()).replace(/[\s-]/g, "");
    const province    = String(body.province ?? "").trim();
    const city        = String(body.city ?? "").trim();
    const address     = String(body.address ?? "").trim();
    const postal_code = toLatinDigits(String(body.postal_code ?? "").trim()).replace(/\s/g, "");

    if (!token) return jsonResponse({ error: "توکن ارسال نشده" }, 401);

    const user = await getSessionUser(token);
    if (!user) return jsonResponse({ error: "نشست معتبر نیست" }, 401);

    if (!order_id || !full_name || !phone || !province || !city || !address || !postal_code) {
      return jsonResponse({ error: "لطفاً همه‌ی فیلدها را کامل کنید" }, 400);
    }

    if (!/^(?:0?9\d{9}|989\d{9})$/.test(phone)) {
      return jsonResponse({ error: "شماره تماس معتبر نیست" }, 400);
    }

    if (!/^\d{10}$/.test(postal_code)) {
      return jsonResponse({ error: "کد پستی باید ۱۰ رقم باشد" }, 400);
    }

    // ۱) سفارش باید وجود داشته باشد، متعلق به همین کاربر باشد و paid باشد
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", order_id)
      .maybeSingle();

    if (!order) return jsonResponse({ error: "سفارش پیدا نشد" }, 404);

    if (String(order.user_id) !== String(user.id)) {
      return jsonResponse({ error: "این سفارش متعلق به شما نیست" }, 403);
    }

    if (order.status !== "paid") {
      return jsonResponse({ error: "این سفارش هنوز پرداخت نشده است" }, 400);
    }

    // ۲) فقط برای سفارش‌هایی که محصول فیزیکی دارند
    const courseIds = Array.isArray(order.course_ids) ? order.course_ids : [];
    let needsShipping = false;
    if (courseIds.length > 0) {
      const { data: phys } = await supabaseAdmin
        .from("courses")
        .select("id")
        .in("id", courseIds)
        .eq("requires_shipping", true);
      needsShipping = (phys ?? []).length > 0;
    }

    if (!needsShipping) {
      return jsonResponse({ error: "این سفارش نیازی به ارسال پستی ندارد" }, 400);
    }

    // ۳) ثبت یا به‌روزرسانی آدرس (هر سفارش فقط یک آدرس)
    const { error: upErr } = await supabaseAdmin
      .from("shipments")
      .upsert(
        {
          order_id: order.id,
          user_id: String(user.id),
          full_name,
          phone,
          province,
          city,
          address,
          postal_code,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "order_id" }
      );

    if (upErr) {
      console.error(upErr);
      return jsonResponse({ error: "خطا در ذخیره آدرس" }, 500);
    }

    return jsonResponse({ success: true });
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
