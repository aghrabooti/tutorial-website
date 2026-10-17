import { query } from "../../../../lib/postgres.js";
import { findActivePostgresSessionUser, jsonNoStore, isValidSessionToken } from "../../../../lib/session-token.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ZP_PROD_BASE = "https://payment.zarinpal.com/pg";
const ZP_SANDBOX_BASE = "https://sandbox.zarinpal.com/pg";
const MERCHANT_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TEST_MERCHANT_IDS = new Set([
  "00000000-0000-0000-0000-000000000000",
  "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
]);
const ZP_ERRORS = {
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

function gatewayConfig() {
  const merchantId = (process.env.ZARINPAL_MERCHANT_ID ?? "").trim();
  const sandboxFlag = (process.env.ZARINPAL_SANDBOX ?? "false").trim().toLowerCase() === "true";
  const callbackUrl = (process.env.ZARINPAL_CALLBACK_URL ?? "").trim();
  const priceToRial = Number(process.env.PRICE_TO_RIAL_FACTOR ?? "10");
  const testMerchant = TEST_MERCHANT_IDS.has(merchantId.toLowerCase());

  if (!MERCHANT_RE.test(merchantId)) {
    return {
      ok: false,
      error: "درگاه پرداخت پیکربندی نشده است. مقدار secret با نام ZARINPAL_MERCHANT_ID را با مرچنت‌کد ۳۶ کاراکتری زرین‌پال تنظیم کنید.",
    };
  }

  const sandbox = sandboxFlag || testMerchant;
  if (!sandbox && !/^https:\/\//i.test(callbackUrl)) {
    return {
      ok: false,
      error: "آدرس بازگشت (ZARINPAL_CALLBACK_URL) برای درگاه واقعی باید یک آدرس https عمومی باشد؛ مثال: https://example.com/payment-result",
    };
  }
  if (sandbox && !callbackUrl) {
    return { ok: false, error: "آدرس بازگشت (ZARINPAL_CALLBACK_URL) پیکربندی نشده است" };
  }

  return {
    ok: true,
    sandbox,
    base: sandbox ? ZP_SANDBOX_BASE : ZP_PROD_BASE,
    merchantId,
    callbackUrl,
    priceToRial,
  };
}

function isPhysicalCourse(course) {
  if (!course) return false;
  if (course.requires_shipping === true) return true;
  const type = String(course.type ?? "").trim().toLowerCase();
  return type === "book" || type === "lecture";
}

function toLocalMobile(phone) {
  return phone && phone.startsWith("98") && phone.length === 12
    ? `0${phone.substring(2)}`
    : phone;
}

function effectivePrice(course) {
  return Number(
    course.discount_price != null && Number(course.discount_price) > 0
      ? course.discount_price
      : course.price ?? 0
  );
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "درخواست نامعتبر است" }, 400);
  }

  const token = body?.token;
  if (!isValidSessionToken(token)) return jsonNoStore({ error: "توکن ارسال نشده" }, 401);

  const gateway = gatewayConfig();
  if (!gateway.ok) {
    console.error("[api/functions/payment-request] Gateway is misconfigured:", gateway.error);
    return jsonNoStore({ error: gateway.error, gateway_configured: false }, 500);
  }
  if (gateway.sandbox) console.warn("[api/functions/payment-request] Running with Zarinpal sandbox");

  try {
    const auth = await findActivePostgresSessionUser(token, ["id", "phone", "first_name", "last_name"]);
    if (auth.error && !auth.expired) throw auth.error;
    if (auth.userError) throw auth.userError;
    if (!auth.user) return jsonNoStore({ error: "نشست معتبر نیست" }, 401);
    const user = auth.user;

    const { rows: paidOrders } = await query(
      `SELECT course_ids
       FROM public.orders
       WHERE user_id = $1 AND status = 'paid'`,
      [String(user.id)]
    );
    const owned = new Set(paidOrders.flatMap((order) =>
      Array.isArray(order.course_ids) ? order.course_ids.map(String) : []
    ));

    let items = [];
    let source = "cart";

    if (body?.course_id) {
      source = "direct";
      const { rows: courses } = await query(
        `SELECT id, title, type, price, discount_price, requires_shipping
         FROM public.courses
         WHERE id = $1
         LIMIT 1`,
        [body.course_id]
      );
      const course = courses[0];
      if (!course) return jsonNoStore({ error: "دوره پیدا نشد" }, 404);
      if (owned.has(String(course.id))) {
        return jsonNoStore({ error: "این دوره قبلاً خریداری شده است" }, 409);
      }
      items = [{
        course_id: course.id,
        title: course.title,
        unit_price: effectivePrice(course),
        type: course.type ?? "course",
        requires_shipping: isPhysicalCourse(course),
      }];
    } else {
      const { rows: cartRows } = await query(
        `SELECT c.id, c.title, c.type, c.price, c.discount_price, c.requires_shipping
         FROM public.cart_items AS ci
         INNER JOIN public.courses AS c ON c.id = ci.course_id
         WHERE ci.user_id = $1`,
        [user.id]
      );
      items = cartRows
        .filter((course) => !owned.has(String(course.id)))
        .map((course) => ({
          course_id: course.id,
          title: course.title,
          unit_price: effectivePrice(course),
          type: course.type ?? "course",
          requires_shipping: isPhysicalCourse(course),
        }));
    }

    if (items.length === 0) {
      return jsonNoStore({ error: "آیتمی برای پرداخت وجود ندارد؛ شاید همه را قبلاً خریده‌اید" }, 400);
    }

    const needsShipping = items.some((item) => item.requires_shipping === true);
    if (needsShipping) {
      const { rows: addresses } = await query(
        "SELECT user_id FROM public.user_addresses WHERE user_id = $1 LIMIT 1",
        [String(user.id)]
      );
      if (addresses.length === 0 || !body?.address_confirmed) {
        return jsonNoStore({
          error: "این سفارش شامل محصول فیزیکی است؛ لطفاً ابتدا نشانی ارسال را بررسی و ثبت کنید",
          needs_address: true,
        }, 400);
      }
    }

    const amountRial = Math.round(
      items.reduce((sum, item) => sum + item.unit_price, 0) * gateway.priceToRial
    );
    if (amountRial < 1000) return jsonNoStore({ error: "مبلغ قابل پرداخت معتبر نیست" }, 400);

    const snapshot = items.map((item) => ({
      course_id: item.course_id,
      title: item.title,
      type: item.type,
      unit_price_rial: item.unit_price * gateway.priceToRial,
      requires_shipping: item.requires_shipping === true,
    }));

    const { rows: createdOrders } = await query(
      `INSERT INTO public.orders
         (user_id, amount_rial, description, status, source, items, course_ids)
       VALUES ($1, $2, $3, 'init', $4, $5::jsonb, $6::text[])
       RETURNING id`,
      [
        String(user.id),
        amountRial,
        `خرید ${snapshot.length} محصول آموزشی — آکادمی استاد مهدی عزیزی`,
        source,
        JSON.stringify(snapshot),
        snapshot.map((item) => String(item.course_id)),
      ]
    );
    const order = createdOrders[0];
    if (!order) {
      console.error("[api/functions/payment-request] PostgreSQL order insert returned no row");
      return jsonNoStore({ error: "خطا در ساخت سفارش" }, 500);
    }

    const gatewayResponse = await fetch(`${gateway.base}/v4/payment/request.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        merchant_id: gateway.merchantId,
        amount: amountRial,
        callback_url: gateway.callbackUrl,
        description: `خرید ${snapshot.length} محصول آموزشی`,
        metadata: {
          mobile: toLocalMobile(user.phone ?? ""),
          order_id: String(order.id),
        },
      }),
    });
    const result = await gatewayResponse.json();
    const code = result?.data?.code ?? result?.errors?.code;

    if (code !== 100) {
      await query("UPDATE public.orders SET status = 'failed' WHERE id = $1 AND status = 'init'", [order.id]);
      console.error("[api/functions/payment-request] Zarinpal request failed:", code, result);
      return jsonNoStore({
        error: ZP_ERRORS[code] ?? "خطا در اتصال به درگاه پرداخت",
        code,
        sandbox: gateway.sandbox,
      }, 502);
    }

    const authority = result.data.authority;
    const { rows: pendingOrders } = await query(
      `UPDATE public.orders
       SET status = 'pending', authority = $1
       WHERE id = $2 AND status = 'init'
       RETURNING id`,
      [authority, order.id]
    );
    if (pendingOrders.length === 0) {
      console.error("[api/functions/payment-request] Could not persist Zarinpal authority for order", order.id);
      return jsonNoStore({ error: "خطا در ثبت سفارش درگاه" }, 500);
    }

    return jsonNoStore({
      success: true,
      pay_url: `${gateway.base}/StartPay/${authority}`,
      authority,
      sandbox: gateway.sandbox,
      needs_shipping: needsShipping,
    });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith("Missing server environment variable:");
    console.error("[api/functions/payment-request] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس پرداخت تنظیم نشده است" : "خطا در آماده‌سازی پرداخت" },
      missingConfig ? 503 : 500
    );
  }
}
