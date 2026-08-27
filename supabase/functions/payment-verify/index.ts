// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// payment-verify
// ورودی: { authority }
//   سفارش را از دیتابیس با همان authority پیدا می‌کند (authority عملاً توکن
//   احراز است؛ حتی اگر سشن کاربر وسط پرداخت منقضی شده باشد کار درست انجام می‌شود)،
//   با مبلغِ ذخیره‌شده‌ی خودمان وریفای می‌کند، و در صورت موفقیت:
//   ۱) سفارش → paid (به‌همراه ref_id و card_pan)
//   ۲) دوره‌ها به کاربر اعطا می‌شود
//   ۳) در حالت خرید سبد، آیتم‌ها از سبد پاک می‌شود
//   آیدمپوتنت: کد ۱۰۰ و ۱۰۱ زرین‌پال هر دو «موفق» تلقی می‌شوند و اجرای دوباره‌ی
//   این تابع هیچ دوره‌ای را دوبار اعطا نمی‌کند.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MERCHANT_ID = Deno.env.get("ZARINPAL_MERCHANT_ID") ?? "";
const SANDBOX = (Deno.env.get("ZARINPAL_SANDBOX") ?? "true") === "true";

// ⚠️ باید دقیقاً مثل payment-request باشد:
const CART_TABLE = "cart_items";

const ZP_BASE = SANDBOX
  ? "https://sandbox.zarinpal.com/pg"
  : "https://payment.zarinpal.com/pg";

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

const ZP_ERRORS: Record<number, string> = {
  "-9": "خطای اعتبارسنجی درگاه",
  "-10": "مرچنت‌کد یا IP پذیرنده صحیح نیست",
  "-11": "درگاه فعال نیست؛ با پشتیبانی زرین‌پال تماس بگیرید",
  "-12": "تلاش بیش از حد در بازه‌ی زمانی کوتاه",
  "-33": "رقم تراکنش با رقم پرداخت‌شده مطابقت ندارد",
  "-50": "مبلغ وریفای با مبلغ تراکنش متفاوت است",
  "-51": "پرداخت ناموفق بود",
  "-52": "خطای غیرمنتظره؛ با پشتیبانی تماس بگیرید",
  "-53": "شناسه‌ی تراکنش متعلق به این پذیرنده نیست",
  "-54": "شناسه‌ی تراکنش نامعتبر یا منقضی است",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { authority } = await req.json();

    if (!authority)
      return jsonResponse({ error: "شناسه‌ی تراکنش ارسال نشده" }, 400);
    if (!MERCHANT_ID)
      return jsonResponse({ error: "درگاه پرداخت پیکربندی نشده است" }, 500);

    // ۱) پیدا کردن سفارش
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("authority", authority)
      .maybeSingle();

    if (!order) return jsonResponse({ error: "سفارش پیدا نشد" }, 404);

    // آیدمپوتنت: اگر قبلاً نهایی شده، همان را برگردان
    if (order.status === "paid") {
      return jsonResponse({
        success: true,
        ref_id: order.ref_id,
        already: true,
      });
    }
    if (order.status !== "pending") {
      return jsonResponse(
        { error: "این تراکنش قابل تأیید نیست", status: order.status },
        400
      );
    }

    // ۲) وریفای با مبلغِ خودمان (نه مبلغِ کلاینت)
    const zpRes = await fetch(`${ZP_BASE}/v4/payment/verify.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        merchant_id: MERCHANT_ID,
        amount: order.amount_rial,
        authority,
      }),
    });

    const zp = await zpRes.json();
    const code = zp?.data?.code ?? zp?.errors?.code;

    if (code === 100 || code === 101) {
      const refId = zp?.data?.ref_id ?? null;
      const cardPan = zp?.data?.card_pan ?? null;

      // نهایی‌سازی اتمیک: فقط اگر هنوز pending است
      const { data: updated } = await supabaseAdmin
        .from("orders")
        .update({
          status: "paid",
          ref_id: refId,
          card_pan: cardPan,
          verified_at: new Date().toISOString(),
        })
        .eq("id", order.id)
        .eq("status", "pending")
        .select("id");

      if (!updated || updated.length === 0) {
        // یک درخواست موازی همین لحظه نهایی‌اش کرده؛ همان را برمی‌گردانیم
        const { data: fresh } = await supabaseAdmin
          .from("orders")
          .select("ref_id")
          .eq("id", order.id)
          .single();
        return jsonResponse({
          success: true,
          ref_id: fresh?.ref_id ?? refId,
          already: true,
        });
      }

      // ۳) اعطای دوره‌ها = همین رکورد سفارش با وضعیت paid.
      //    جدول جداگانه‌ای برای خرید وجود ندارد؛ check-course-access
      //    هم از همین جدول می‌خواند.
      const items = Array.isArray(order.items) ? order.items : [];
      const courseIds = items
        .map((i: any) => i.course_id)
        .filter((v: any) => v != null);

      // ۴) خالی کردن سبد برای آیتم‌های خریداری‌شده
      if (order.source === "cart" && courseIds.length > 0) {
        await supabaseAdmin
          .from(CART_TABLE)
          .delete()
          .eq("user_id", order.user_id)
          .in("course_id", courseIds);
      }

      return jsonResponse({ success: true, ref_id: refId, code });
    }

    // پرداخت تأیید نشد
    await supabaseAdmin
      .from("orders")
      .update({ status: "failed" })
      .eq("id", order.id);

    return jsonResponse(
      { success: false, error: ZP_ERRORS[code] ?? "پرداخت تأیید نشد", code },
      402
    );
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
