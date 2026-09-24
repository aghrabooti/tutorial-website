// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// payment-request
// ورودی:  { token, course_id?, address_confirmed? }
//   - بدون course_id  → پرداخت کل سبد خرید
//   - با course_id    → خرید مستقیم یک دوره (Buy Now)
// خروجی: { success, pay_url, authority, sandbox }
// مبلغ همیشه از دیتابیس خوانده می‌شود (هرگز از کلاینت گرفته نمی‌شود).
//
// ── درگاه واقعی (production) ─────────────────────────────────────────────────
// پیش‌فرض این فایل روی درگاهِ **واقعی** زرین‌پال است. برای فعال شدن فقط کافی است
// این دو secret روی پروژه‌ی Supabase تنظیم شود:
//
//   ZARINPAL_MERCHANT_ID = <مرچنت‌کد ۳۶ کاراکتری واقعی خودتان>
//   ZARINPAL_SANDBOX     = false        (یا اصلاً ست نکنید؛ پیش‌فرض false است)
//   ZARINPAL_CALLBACK_URL = https://<دامنه‌ی سایت>/payment-result
//   PRICE_TO_RIAL_FACTOR  = 10          (اگر قیمت‌ها تومان است)
//
// فقط اگر مرچنت‌کد را روی UUID تستی (00...00) بگذارید، خودکار به سندباکس می‌رود.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── پیکربندی از طریق supabase secrets ──
const MERCHANT_ID = (Deno.env.get("ZARINPAL_MERCHANT_ID") ?? "").trim();

// پیش‌فرض = درگاه واقعی. برای تست، مقدار "true" را ست کنید.
const SANDBOX_FLAG = (Deno.env.get("ZARINPAL_SANDBOX") ?? "false")
  .trim()
  .toLowerCase() === "true";

const CALLBACK_URL = (Deno.env.get("ZARINPAL_CALLBACK_URL") ?? "").trim();
const PRICE_TO_RIAL = Number(Deno.env.get("PRICE_TO_RIAL_FACTOR") ?? "10"); // قیمت‌های دیتابیس اگر تومان‌اند: 10 — اگر ریال‌اند: 1

// ⚠️ اگر نام جدول سبد خرید شما فرق دارد فقط همین خط را تغییر دهید:
const CART_TABLE = "cart_items";

// مرچنت‌کد تستی زرین‌پال → سندباکس
const TEST_MERCHANT_IDS = new Set([
  "00000000-0000-0000-0000-000000000000",
  "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
]);

const MERCHANT_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const ZP_PROD_BASE = "https://payment.zarinpal.com/pg";
const ZP_SANDBOX_BASE = "https://sandbox.zarinpal.com/pg";

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

// پیام‌های رایج زرین‌پال (v4)
const ZP_ERRORS: Record<number, string> = {
  "-9": "خطای اعتبارسنجی درگاه",
  "-10": "مرچنت‌کد یا IP پذیرنده صحیح نیست",
  "-11": "درگاه شما فعال نیست؛ با پشتیبانی زرین‌پال تماس بگیرید",
  "-12": "تلاش بیش از حد در بازه‌ی زمانی کوتاه",
  "-15": "ترمینال به حالت تعلیق درآمده است",
  "-16": "سطح تأیید پذیرنده پایین‌تر از سطح نقره‌ای است",
  "-30": "اجازه‌ی دسترسی به این متد وجود ندارد",
  "-31": "حساب بانکی تأیید نشده است",
  "-33": "رقم تراکنش مغایرت دارد",
  "-51": "پرداخت ناموفق بود",
  "-52": "خطای غیرمنتظره؛ با پشتیبانی تماس بگیرید",
  "-53": "شناسه‌ی تراکنش متعلق به این پذیرنده نیست",
  "-54": "شناسه‌ی تراکنش نامعتبر یا منقضی است",
};

async function hashText(text: string) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// همان منطق check-session: توکن → کاربر
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

// 989123456789  →  09123456789 (فرمت مورد قبول زرین‌پال)
function toLocalMobile(phone: string) {
  if (phone && phone.startsWith("98") && phone.length === 12) {
    return "0" + phone.substring(2);
  }
  return phone;
}

// ── تشخیص محصول فیزیکی (کتاب / جزوه) ─────────────────────────────────────────
// ملاک اول: ستون requires_shipping؛ ملاک دوم: نوع محصول (book/lecture).
// هر کدام true باشد، محصول پستی محسوب می‌شود تا هیچ سفارشی از قلم نیفتد.
function isPhysicalCourse(course: any) {
  if (!course) return false;
  if (course.requires_shipping === true) return true;

  const type = String(course.type ?? "").trim().toLowerCase();
  return type === "book" || type === "lecture";
}

// ── درگاه: تولید/بررسی پیکربندی ──────────────────────────────────────────────
function gatewayConfig() {
  const isTestMerchant = TEST_MERCHANT_IDS.has(MERCHANT_ID.toLowerCase());
  const merchantLooksValid = MERCHANT_RE.test(MERCHANT_ID);

  // بدون مرچنت‌کد معتبر، درگاه واقعی کار نمی‌کند → خطای واضح می‌دهیم
  if (!merchantLooksValid) {
    return {
      ok: false,
      error:
        "درگاه پرداخت پیکربندی نشده است. مقدار secret با نام ZARINPAL_MERCHANT_ID را با مرچنت‌کد ۳۶ کاراکتری زرین‌پال تنظیم کنید.",
    };
  }

  const sandbox = SANDBOX_FLAG || isTestMerchant;

  if (!sandbox && !/^https:\/\//i.test(CALLBACK_URL)) {
    return {
      ok: false,
      error:
        "آدرس بازگشت (ZARINPAL_CALLBACK_URL) برای درگاه واقعی باید یک آدرس https عمومی باشد؛ مثال: https://example.com/payment-result",
    };
  }

  if (sandbox && !CALLBACK_URL) {
    return {
      ok: false,
      error: "آدرس بازگشت (ZARINPAL_CALLBACK_URL) پیکربندی نشده است",
    };
  }

  return {
    ok: true,
    sandbox,
    base: sandbox ? ZP_SANDBOX_BASE : ZP_PROD_BASE,
    merchant_id: MERCHANT_ID,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { token, course_id, address_confirmed } = await req.json();

    if (!token) return jsonResponse({ error: "توکن ارسال نشده" }, 401);

    const gateway = gatewayConfig();
    if (!gateway.ok) {
      console.error("[payment-request] gateway misconfigured:", gateway.error);
      return jsonResponse({ error: gateway.error, gateway_configured: false }, 500);
    }

    if (gateway.sandbox) {
      console.warn(
        "[payment-request] ⚠️ در حال اجرا در حالت سندباکس (آزمایشی) زرین‌پال"
      );
    }

    const user = await getSessionUser(token);
    if (!user) return jsonResponse({ error: "نشست معتبر نیست" }, 401);

    // ۱) دوره‌هایی که کاربر قبلاً خریده — منبع حقیقت: سفارش‌های paid
    const { data: paidOrders } = await supabaseAdmin
      .from("orders")
      .select("course_ids")
      .eq("user_id", String(user.id))
      .eq("status", "paid");

    const owned = new Set(
      (paidOrders ?? []).flatMap((o: any) => o.course_ids ?? [])
    );

    // ۲) جمع‌آوری آیتم‌های قابل پرداخت — همیشه با قیمتِ دیتابیس
    let items: any[] = [];
    let source = "cart";

    const effectivePrice = (c: any) =>
      Number(
        c.discount_price != null && Number(c.discount_price) > 0
          ? c.discount_price
          : c.price ?? 0
      );

    if (course_id) {
      source = "direct";
      const { data: course } = await supabaseAdmin
        .from("courses")
        .select("id, title, type, price, discount_price, requires_shipping")
        .eq("id", course_id)
        .maybeSingle();

      if (!course) return jsonResponse({ error: "دوره پیدا نشد" }, 404);
      if (owned.has(String(course.id)))
        return jsonResponse({ error: "این دوره قبلاً خریداری شده است" }, 409);

      items = [
        {
          course_id: course.id,
          title: course.title,
          unit_price: effectivePrice(course),
          type: course.type ?? "course",
          requires_shipping: isPhysicalCourse(course),
        },
      ];
    } else {
      const { data: rows, error: cartErr } = await supabaseAdmin
        .from(CART_TABLE)
        .select(
          "id, course_id, courses(id, title, type, price, discount_price, requires_shipping)"
        )
        .eq("user_id", user.id);

      if (cartErr) {
        console.error(cartErr);
        return jsonResponse({ error: "خطا در خواندن سبد خرید" }, 500);
      }

      items = (rows ?? [])
        .filter((r: any) => r.courses && !owned.has(String(r.courses.id)))
        .map((r: any) => ({
          course_id: r.courses.id,
          title: r.courses.title,
          unit_price: effectivePrice(r.courses),
          type: r.courses.type ?? "course",
          requires_shipping: isPhysicalCourse(r.courses),
        }));
    }

    if (items.length === 0)
      return jsonResponse(
        { error: "آیتمی برای پرداخت وجود ندارد؛ شاید همه را قبلاً خریده‌اید" },
        400
      );

    // ۲-الف) نشانی قبل از پول! اگر سفارش شامل محصول فیزیکی (کتاب/جزوه) است،
    // قبل از هر پرداختی کاربر باید یک بار فرم نشانی را دیده و تأیید کرده باشد
    // (فرم با نشانی قبلی پر می‌شود و قابل اصلاح است؛ address_confirmed فقط
    // وقتی true است که کاربر مستقیم از همان فرم برگشته باشد).
    const hasPhysical = items.some((i: any) => i.requires_shipping === true);

    if (hasPhysical) {
      const { data: addr } = await supabaseAdmin
        .from("user_addresses")
        .select("user_id")
        .eq("user_id", String(user.id))
        .maybeSingle();

      if (!addr || !address_confirmed) {
        return jsonResponse(
          {
            error:
              "این سفارش شامل محصول فیزیکی است؛ لطفاً ابتدا نشانی ارسال را بررسی و ثبت کنید",
            needs_address: true,
          },
          400
        );
      }
    }

    const amountRial = Math.round(
      items.reduce((sum, i) => sum + i.unit_price, 0) * PRICE_TO_RIAL
    );

    if (amountRial < 1000)
      return jsonResponse({ error: "مبلغ قابل پرداخت معتبر نیست" }, 400);

    const snapshot = items.map((i) => ({
      course_id: i.course_id,
      title: i.title,
      type: i.type,
      unit_price_rial: i.unit_price * PRICE_TO_RIAL,
      // ⚠️ حیاتی برای انبار/ارسال: تعیین می‌کند این قلم باید پستی فرستاده شود یا نه
      requires_shipping: i.requires_shipping === true,
    }));

    // ۳) ثبت سفارش قبل از تماس با درگاه (برای رهگیری تلاش‌ها)
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .insert({
        user_id: String(user.id),
        amount_rial: amountRial,
        description: `خرید ${snapshot.length} محصول آموزشی — آکادمی استاد مهدی عزیزی`,
        status: "init",
        source,
        items: snapshot,
        course_ids: snapshot.map((i: any) => String(i.course_id)),
      })
      .select("id")
      .single();

    if (orderErr) {
      console.error(orderErr);
      return jsonResponse({ error: "خطا در ساخت سفارش" }, 500);
    }

    // ۴) درخواست authority از زرین‌پال
    const zpRes = await fetch(`${gateway.base}/v4/payment/request.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        merchant_id: gateway.merchant_id,
        amount: amountRial,
        callback_url: CALLBACK_URL,
        description: `خرید ${snapshot.length} محصول آموزشی`,
        metadata: {
          mobile: toLocalMobile(user.phone ?? ""),
          order_id: String(order.id),
        },
      }),
    });

    const zp = await zpRes.json();
    const code = zp?.data?.code ?? zp?.errors?.code;

    if (code !== 100) {
      await supabaseAdmin
        .from("orders")
        .update({ status: "failed" })
        .eq("id", order.id);

      console.error("[payment-request] zarinpal error", code, zp);

      return jsonResponse(
        {
          error: ZP_ERRORS[code] ?? "خطا در اتصال به درگاه پرداخت",
          code,
          sandbox: gateway.sandbox,
        },
        502
      );
    }

    const authority = zp.data.authority;

    await supabaseAdmin
      .from("orders")
      .update({ status: "pending", authority })
      .eq("id", order.id);

    return jsonResponse({
      success: true,
      pay_url: `${gateway.base}/StartPay/${authority}`,
      authority,
      sandbox: gateway.sandbox,
      needs_shipping: hasPhysical,
    });
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
