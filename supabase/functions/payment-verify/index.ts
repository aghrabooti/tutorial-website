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
//   ۴) اگر سفارش شامل کتاب/جزوه باشد، **مرسوله‌ی پستی** ساخته می‌شود
//      تا در پنل مدیریت (تب مرسوله‌های پستی) برای ارسال دیده شود
//   آیدمپوتنت: کد ۱۰۰ و ۱۰۱ زرین‌پال هر دو «موفق» تلقی می‌شوند و اجرای دوباره‌ی
//   این تابع هیچ دوره‌ای را دوبار اعطا نمی‌کند.
//
// ── محیط درگاه ───────────────────────────────────────────────────────────────
// پیش‌فرض روی درگاهِ واقعی است؛ ولی اگر authority از سندباکس آمده باشد
// (با حرف S شروع می‌شود) خودکار روی سندباکس وریفای می‌کند تا تراکنش‌های
// نیمه‌کاره‌ی قبلی هم بی‌نتیجه نمانند.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MERCHANT_ID = (Deno.env.get("ZARINPAL_MERCHANT_ID") ?? "").trim();
const SANDBOX_FLAG = (Deno.env.get("ZARINPAL_SANDBOX") ?? "false")
  .trim()
  .toLowerCase() === "true";

// ⚠️ باید دقیقاً مثل payment-request باشد:
const CART_TABLE = "cart_items";

const TEST_MERCHANT_IDS = new Set([
  "00000000-0000-0000-0000-000000000000",
  "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
]);

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

// کدهایی که نشان می‌دهند احتمالاً محیط درگاه اشتباه انتخاب شده است
const ENV_MISMATCH_CODES = new Set([-9, -10, -11, -15, -16, -53, -54]);

// ── تشخیص محصول فیزیکی (کتاب / جزوه) ─────────────────────────────────────────
// ملاک اول: requires_shipping در اسنپ‌شات سفارش/جدول courses
// ملاک دوم: نوع محصول (book / lecture)
function isPhysicalCourse(course: any) {
  if (!course) return false;
  if (course.requires_shipping === true) return true;

  const type = String(course.type ?? "").trim().toLowerCase();
  return type === "book" || type === "lecture";
}

// آیا این سفارش نیاز به ارسال پستی دارد؟
async function orderNeedsShipping(order: any) {
  // ۱) اسنپ‌شات خود سفارش (سفارش‌های جدید همیشه این را دارند)
  const items = Array.isArray(order?.items) ? order.items : [];
  if (items.some((i: any) => i?.requires_shipping === true)) return true;
  if (
    items.length > 0 &&
    items.every((i: any) => i?.requires_shipping === false) &&
    items.some((i: any) => i?.type)
  ) {
    // اسنپ‌شات کامل و بدون نیاز پستی است
    return false;
  }

  // ۲) اگر اسنپ‌شات قدیمی بود، از جدول courses بخوان
  const courseIds = Array.isArray(order?.course_ids) ? order.course_ids : [];
  if (courseIds.length === 0) return false;

  let { data: courses, error } = await supabaseAdmin
    .from("courses")
    .select("id, type, requires_shipping")
    .in("id", courseIds);

  if (error) {
    // اگر ستون requires_shipping نبود، فقط با type تصمیم بگیر
    const retry = await supabaseAdmin
      .from("courses")
      .select("id, type")
      .in("id", courseIds);
    courses = retry.data;
  }

  return (courses ?? []).some((c: any) => isPhysicalCourse(c));
}

// ── ثبت مرسوله‌ی پستی برای یک سفارش (بدون وابستگی به unique بودن order_id) ──
// اگر مرسوله وجود داشته باشد دست‌نخورده می‌ماند؛ در غیر این صورت از نشانی
// ثبت‌شده‌ی کاربر ساخته می‌شود. خطاها لاگ می‌شوند ولی پرداخت را خراب نمی‌کنند.
async function ensureShipment(order: any) {
  try {
    const { data: existing, error: selErr } = await supabaseAdmin
      .from("shipments")
      .select("id, status")
      .eq("order_id", String(order.id))
      .limit(1);

    if (!selErr && existing && existing.length > 0) {
      return { created: false, shipment_id: existing[0].id };
    }
    if (selErr) console.error("[payment-verify] shipments select:", selErr);

    const { data: addr, error: addrErr } = await supabaseAdmin
      .from("user_addresses")
      .select("*")
      .eq("user_id", String(order.user_id))
      .maybeSingle();

    if (addrErr) console.error("[payment-verify] address select:", addrErr);

    if (!addr) {
      console.error(
        `[payment-verify] سفارش ${order.id} نیاز به ارسال پستی دارد ولی نشانی کاربر ${order.user_id} ثبت نشده است`
      );
      return { created: false, shipment_id: null, missing_address: true };
    }

    const now = new Date().toISOString();

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("shipments")
      .insert({
        order_id: String(order.id),
        user_id: String(order.user_id),
        full_name: addr.full_name,
        phone: addr.phone,
        province: addr.province,
        city: addr.city,
        address: addr.address,
        postal_code: addr.postal_code,
        status: "pending",
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .maybeSingle();

    if (insErr) {
      console.error("[payment-verify] shipment insert failed:", insErr);
      return { created: false, shipment_id: null, error: insErr.message };
    }

    console.log(
      `[payment-verify] ✅ مرسوله‌ی پستی برای سفارش ${order.id} ساخته شد`
    );

    return { created: true, shipment_id: inserted?.id ?? null };
  } catch (e) {
    console.error("[payment-verify] ensureShipment crashed:", e);
    return { created: false, shipment_id: null };
  }
}

// ── وریفای با انتخابِ خودکارِ محیط درست ──────────────────────────────────────
async function verifyWithBase(base: string, authority: string, amount: number) {
  const res = await fetch(`${base}/v4/payment/verify.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      merchant_id: MERCHANT_ID,
      amount,
      authority,
    }),
  });

  const payload = await res.json().catch(() => ({}));
  const code = payload?.data?.code ?? payload?.errors?.code ?? null;
  return { payload, code };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { authority } = await req.json();

    if (!authority)
      return jsonResponse({ error: "شناسه‌ی تراکنش ارسال نشده" }, 400);
    if (!MERCHANT_ID)
      return jsonResponse(
        {
          error:
            "درگاه پرداخت پیکربندی نشده است؛ secret با نام ZARINPAL_MERCHANT_ID تنظیم نشده",
        },
        500
      );

    // ۱) پیدا کردن سفارش
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("authority", authority)
      .maybeSingle();

    if (!order) return jsonResponse({ error: "سفارش پیدا نشد" }, 404);

    // آیدمپوتنت: اگر قبلاً نهایی شده، همان را برگردان
    // (و اگر مرسوله‌اش ساخته نشده بود، همین‌جا ساخته می‌شود)
    if (order.status === "paid") {
      const needsShipping = await orderNeedsShipping(order);
      if (needsShipping) await ensureShipment(order);

      return jsonResponse({
        success: true,
        ref_id: order.ref_id,
        already: true,
        order_id: order.id,
        needs_shipping: needsShipping,
      });
    }
    if (order.status !== "pending") {
      return jsonResponse(
        { error: "این تراکنش قابل تأیید نیست", status: order.status },
        400
      );
    }

    // ۲) وریفای با مبلغِ خودمان (نه مبلغِ کلاینت)
    const isTestMerchant = TEST_MERCHANT_IDS.has(MERCHANT_ID.toLowerCase());
    const sandbox = SANDBOX_FLAG || isTestMerchant;

    // اگر authority از سندباکس می‌آید (با S شروع می‌شود) اول سندباکس را امتحان کن
    const sandboxAuthority = /^s/i.test(String(authority));

    let firstBase = sandbox ? ZP_SANDBOX_BASE : ZP_PROD_BASE;
    let secondBase = sandbox ? ZP_PROD_BASE : ZP_SANDBOX_BASE;

    if (sandboxAuthority && !sandbox) {
      firstBase = ZP_SANDBOX_BASE;
      secondBase = ZP_PROD_BASE;
    }

    let { payload: zp, code } = await verifyWithBase(
      firstBase,
      authority,
      order.amount_rial
    );

    // اگر خطای «محیط اشتباه» گرفتیم، یک‌بار روی محیط دیگر هم امتحان کن
    if (code !== 100 && code !== 101 && ENV_MISMATCH_CODES.has(Number(code))) {
      console.warn(
        `[payment-verify] code=${code} روی ${firstBase}؛ تلاش دوباره روی ${secondBase}`
      );
      const retry = await verifyWithBase(secondBase, authority, order.amount_rial);
      if (retry.code === 100 || retry.code === 101) {
        zp = retry.payload;
        code = retry.code;
      }
    }

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

      const needsShipping = await orderNeedsShipping(order);

      if (!updated || updated.length === 0) {
        // یک درخواست موازی همین لحظه نهایی‌اش کرده؛ همان را برمی‌گردانیم
        const { data: fresh } = await supabaseAdmin
          .from("orders")
          .select("ref_id")
          .eq("id", order.id)
          .single();

        if (needsShipping) await ensureShipment(order);

        return jsonResponse({
          success: true,
          ref_id: fresh?.ref_id ?? refId,
          already: true,
          order_id: order.id,
          needs_shipping: needsShipping,
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

      // ۵) کتاب/جزوه خریده شده → ساخت مرسوله‌ی پستی برای تب «مرسوله‌های پستی»
      let shipment: any = { created: false, shipment_id: null };
      if (needsShipping) {
        shipment = await ensureShipment(order);
      }

      return jsonResponse({
        success: true,
        ref_id: refId,
        code,
        order_id: order.id,
        needs_shipping: needsShipping,
        shipment_created: shipment.created === true,
        shipment_missing_address: shipment.missing_address === true,
      });
    }

    // پرداخت تأیید نشد
    await supabaseAdmin
      .from("orders")
      .update({ status: "failed" })
      .eq("id", order.id);

    console.error("[payment-verify] verify failed", code, zp);

    return jsonResponse(
      { success: false, error: ZP_ERRORS[code] ?? "پرداخت تأیید نشد", code },
      402
    );
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
