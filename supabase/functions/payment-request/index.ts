// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// payment-request
// ورودی:  { token, course_id? }
//   - بدون course_id  → پرداخت کل سبد خرید
//   - با course_id    → خرید مستقیم یک دوره (Buy Now)
// خروجی: { success, pay_url, authority }
// مبلغ همیشه از دیتابیس خوانده می‌شود (هرگز از کلاینت گرفته نمی‌شود).
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── پیکربندی از طریق supabase secrets ──
const MERCHANT_ID   = Deno.env.get("ZARINPAL_MERCHANT_ID") ?? "";
const SANDBOX       = (Deno.env.get("ZARINPAL_SANDBOX") ?? "true") === "true";
const CALLBACK_URL  = Deno.env.get("ZARINPAL_CALLBACK_URL") ?? ""; // مثال: https://your-site.vercel.app/payment-result
const PRICE_TO_RIAL = Number(Deno.env.get("PRICE_TO_RIAL_FACTOR") ?? "10"); // قیمت‌های دیتابیس اگر تومان‌اند: 10 — اگر ریال‌اند: 1

// ⚠️ اگر نام جدول سبد خرید شما فرق دارد فقط همین خط را تغییر دهید:
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { token, course_id } = await req.json();

    if (!token) return jsonResponse({ error: "توکن ارسال نشده" }, 401);
    if (!MERCHANT_ID)
      return jsonResponse({ error: "درگاه پرداخت پیکربندی نشده است" }, 500);
    if (!CALLBACK_URL)
      return jsonResponse({ error: "آدرس بازگشت پیکربندی نشده است" }, 500);

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
        .select("id, title, price, discount_price, requires_shipping")
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
          requires_shipping: Boolean(course.requires_shipping),
        },
      ];
    } else {
      const { data: rows, error: cartErr } = await supabaseAdmin
        .from(CART_TABLE)
        .select("id, course_id, courses(id, title, price, discount_price, requires_shipping)")
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
          requires_shipping: Boolean(r.courses.requires_shipping),
        }));
    }

    if (items.length === 0)
      return jsonResponse(
        { error: "آیتمی برای پرداخت وجود ندارد؛ شاید همه را قبلاً خریده‌اید" },
        400
      );

    // ۲-الف) نشانی قبل از پول! اگر سفارش شامل محصول فیزیکی (کتاب/جزوه) است،
    // کاربر باید از قبل نشانی پستی ثبت کرده باشد؛ در غیر این صورت سایت
    // او را به فرم آدرس می‌برد و هیچ پرداختی شروع نمی‌شود.
    const hasPhysical = items.some((i: any) => i.requires_shipping);

    if (hasPhysical) {
      const { data: addr } = await supabaseAdmin
        .from("user_addresses")
        .select("user_id")
        .eq("user_id", String(user.id))
        .maybeSingle();

      if (!addr) {
        return jsonResponse(
          {
            error:
              "این سفارش شامل محصول فیزیکی است؛ لطفاً ابتدا نشانی ارسال را ثبت کنید",
            needs_address: true,
          },
          400
        );
      }
    }

    const amountRial =
      items.reduce((sum, i) => sum + i.unit_price, 0) * PRICE_TO_RIAL;

    if (amountRial < 1000)
      return jsonResponse({ error: "مبلغ قابل پرداخت معتبر نیست" }, 400);

    const snapshot = items.map((i) => ({
      course_id: i.course_id,
      title: i.title,
      unit_price_rial: i.unit_price * PRICE_TO_RIAL,
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
    const zpRes = await fetch(`${ZP_BASE}/v4/payment/request.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        merchant_id: MERCHANT_ID,
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

      return jsonResponse(
        {
          error: ZP_ERRORS[code] ?? "خطا در اتصال به درگاه پرداخت",
          code,
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
      pay_url: `${ZP_BASE}/StartPay/${authority}`,
      authority,
      sandbox: SANDBOX,
    });
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
