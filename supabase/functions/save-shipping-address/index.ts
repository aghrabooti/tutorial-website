// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// save-shipping-address
// ورودی: { token, full_name, phone, province, city, address, postal_code }
//   نشانی پستیِ کاربر را در پروفایل او ذخیره/به‌روز می‌کند.
//   این نشانی «قبل از پرداخت» گرفته می‌شود: payment-request برای سفارش‌هایی که
//   محصول فیزیکی دارند، بدون وجود این نشانی اجازه‌ی شروع پرداخت نمی‌دهد.
//   بعد از پرداخت موفق، payment-verify از همین نشانی کنار سفارش اسنپ‌شات می‌گیرد.
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
    const { token } = body;

    const full_name   = String(body.full_name ?? "").trim();
    const phone       = toLatinDigits(String(body.phone ?? "").trim()).replace(/[\s-]/g, "");
    const province    = String(body.province ?? "").trim();
    const city        = String(body.city ?? "").trim();
    const address     = String(body.address ?? "").trim();
    const postal_code = toLatinDigits(String(body.postal_code ?? "").trim()).replace(/\s/g, "");

    if (!token) return jsonResponse({ error: "توکن ارسال نشده" }, 401);

    const user = await getSessionUser(token);
    if (!user) return jsonResponse({ error: "نشست معتبر نیست" }, 401);

    if (!full_name || !phone || !province || !city || !address || !postal_code) {
      return jsonResponse({ error: "لطفاً همه‌ی فیلدها را کامل کنید" }, 400);
    }

    if (!/^(?:0?9\d{9}|989\d{9})$/.test(phone)) {
      return jsonResponse({ error: "شماره تماس معتبر نیست" }, 400);
    }

    if (!/^\d{10}$/.test(postal_code)) {
      return jsonResponse({ error: "کد پستی باید ۱۰ رقم باشد" }, 400);
    }

    // هر کاربر یک نشانی — ذخیره‌ی جدید جایگزین قبلی می‌شود
    const { error: upErr } = await supabaseAdmin
      .from("user_addresses")
      .upsert(
        {
          user_id: String(user.id),
          full_name,
          phone,
          province,
          city,
          address,
          postal_code,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
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
