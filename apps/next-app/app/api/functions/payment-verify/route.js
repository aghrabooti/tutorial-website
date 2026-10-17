import { query, withTransaction } from "../../../../lib/postgres.js";
import { jsonNoStore } from "../../../../lib/session-token.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ZP_PROD_BASE = "https://payment.zarinpal.com/pg";
const ZP_SANDBOX_BASE = "https://sandbox.zarinpal.com/pg";
const TEST_MERCHANT_IDS = new Set([
  "00000000-0000-0000-0000-000000000000",
  "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
]);
const ENV_MISMATCH_CODES = new Set([-9, -10, -11, -15, -16, -53, -54]);
const ZP_ERRORS = {
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

function isPhysicalCourse(course) {
  if (!course) return false;
  if (course.requires_shipping === true) return true;
  const type = String(course.type ?? "").trim().toLowerCase();
  return type === "book" || type === "lecture";
}

async function orderNeedsShipping(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (items.some((item) => item?.requires_shipping === true)) return true;
  if (
    items.length > 0 &&
    items.every((item) => item?.requires_shipping === false) &&
    items.some((item) => item?.type)
  ) {
    return false;
  }

  const courseIds = Array.isArray(order?.course_ids) ? order.course_ids.map(String) : [];
  if (courseIds.length === 0) return false;
  const { rows: courses } = await query(
    `SELECT id, type, requires_shipping
     FROM public.courses
     WHERE id::text = ANY($1::text[])`,
    [courseIds]
  );
  return courses.some(isPhysicalCourse);
}

async function ensureShipment(order) {
  try {
    const { rows: existing } = await query(
      "SELECT id, status FROM public.shipments WHERE order_id = $1 LIMIT 1",
      [String(order.id)]
    );
    if (existing.length > 0) return { created: false, shipment_id: existing[0].id };

    const { rows: addresses } = await query(
      "SELECT full_name, phone, province, city, address, postal_code FROM public.user_addresses WHERE user_id = $1 LIMIT 1",
      [String(order.user_id)]
    );
    const address = addresses[0];
    if (!address) {
      console.error(`[api/functions/payment-verify] No shipping address for order ${order.id}`);
      return { created: false, shipment_id: null, missing_address: true };
    }

    const { rows: inserted } = await query(
      `INSERT INTO public.shipments
         (order_id, user_id, full_name, phone, province, city, address, postal_code, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW(), NOW())
       ON CONFLICT (order_id) DO NOTHING
       RETURNING id`,
      [
        String(order.id),
        String(order.user_id),
        address.full_name,
        address.phone,
        address.province,
        address.city,
        address.address,
        address.postal_code,
      ]
    );
    if (inserted.length > 0) return { created: true, shipment_id: inserted[0].id };

    const { rows: raced } = await query(
      "SELECT id FROM public.shipments WHERE order_id = $1 LIMIT 1",
      [String(order.id)]
    );
    return { created: false, shipment_id: raced[0]?.id ?? null };
  } catch (error) {
    console.error("[api/functions/payment-verify] Shipment creation failed:", error?.message ?? error);
    return { created: false, shipment_id: null, error: error?.message ?? "shipment error" };
  }
}

async function verifyWithBase(base, merchantId, authority, amount) {
  const response = await fetch(`${base}/v4/payment/verify.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ merchant_id: merchantId, amount, authority }),
  });
  const payload = await response.json().catch(() => ({}));
  const code = payload?.data?.code ?? payload?.errors?.code ?? null;
  return { payload, code };
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "درخواست نامعتبر است" }, 400);
  }

  const authority = body?.authority;
  if (!authority) return jsonNoStore({ error: "شناسه‌ی تراکنش ارسال نشده" }, 400);

  const merchantId = (process.env.ZARINPAL_MERCHANT_ID ?? "").trim();
  if (!merchantId) {
    return jsonNoStore({
      error: "درگاه پرداخت پیکربندی نشده است؛ secret با نام ZARINPAL_MERCHANT_ID تنظیم نشده",
    }, 500);
  }

  try {
    const { rows: orders } = await query(
      "SELECT * FROM public.orders WHERE authority = $1 LIMIT 1",
      [authority]
    );
    const order = orders[0];
    if (!order) return jsonNoStore({ error: "سفارش پیدا نشد" }, 404);

    if (order.status === "paid") {
      const needsShipping = await orderNeedsShipping(order);
      if (needsShipping) await ensureShipment(order);
      return jsonNoStore({
        success: true,
        ref_id: order.ref_id,
        already: true,
        order_id: order.id,
        needs_shipping: needsShipping,
      });
    }
    if (order.status !== "pending") {
      return jsonNoStore({ error: "این تراکنش قابل تأیید نیست", status: order.status }, 400);
    }

    const sandboxFlag = (process.env.ZARINPAL_SANDBOX ?? "false").trim().toLowerCase() === "true";
    const sandbox = sandboxFlag || TEST_MERCHANT_IDS.has(merchantId.toLowerCase());
    const sandboxAuthority = /^s/i.test(String(authority));
    let firstBase = sandbox ? ZP_SANDBOX_BASE : ZP_PROD_BASE;
    let secondBase = sandbox ? ZP_PROD_BASE : ZP_SANDBOX_BASE;
    if (sandboxAuthority && !sandbox) {
      firstBase = ZP_SANDBOX_BASE;
      secondBase = ZP_PROD_BASE;
    }

    let { payload: gatewayResult, code } = await verifyWithBase(
      firstBase,
      merchantId,
      authority,
      order.amount_rial
    );
    if (code !== 100 && code !== 101 && ENV_MISMATCH_CODES.has(Number(code))) {
      console.warn(`[api/functions/payment-verify] Code ${code}; retrying on alternate Zarinpal environment`);
      const retry = await verifyWithBase(secondBase, merchantId, authority, order.amount_rial);
      if (retry.code === 100 || retry.code === 101) {
        gatewayResult = retry.payload;
        code = retry.code;
      }
    }

    if (code === 100 || code === 101) {
      const refId = gatewayResult?.data?.ref_id ?? null;
      const cardPan = gatewayResult?.data?.card_pan ?? null;
      const result = await withTransaction(async (client) => {
        const { rows: currentRows } = await client.query(
          "SELECT * FROM public.orders WHERE id = $1 FOR UPDATE",
          [order.id]
        );
        const current = currentRows[0];
        if (!current) return { updated: false, already: false, order: null };
        if (current.status === "paid") return { updated: false, already: true, order: current };
        if (current.status !== "pending") return { updated: false, already: false, order: current };

        const { rows: updatedRows } = await client.query(
          `UPDATE public.orders
           SET status = 'paid', ref_id = $1, card_pan = $2, verified_at = NOW()
           WHERE id = $3 AND status = 'pending'
           RETURNING *`,
          [refId, cardPan, order.id]
        );
        const updated = updatedRows[0];
        if (!updated) return { updated: false, already: false, order: current };

        const purchasedCourseIds = (Array.isArray(updated.items) ? updated.items : [])
          .map((item) => item?.course_id)
          .filter((id) => id !== null && id !== undefined)
          .map(String);
        if (updated.source === "cart" && purchasedCourseIds.length > 0) {
          await client.query(
            `DELETE FROM public.cart_items
             WHERE user_id = $1 AND course_id::text = ANY($2::text[])`,
            [String(updated.user_id), purchasedCourseIds]
          );
        }
        return { updated: true, already: false, order: updated };
      });

      if (!result.order) return jsonNoStore({ error: "سفارش پیدا نشد" }, 404);
      if (!result.updated && !result.already) {
        return jsonNoStore({ error: "این تراکنش قابل تأیید نیست", status: result.order.status }, 400);
      }

      const paidOrder = result.order;
      const needsShipping = await orderNeedsShipping(paidOrder);
      const shipment = needsShipping
        ? await ensureShipment(paidOrder)
        : { created: false, missing_address: false };

      if (result.already) {
        return jsonNoStore({
          success: true,
          ref_id: paidOrder.ref_id ?? refId,
          already: true,
          order_id: paidOrder.id,
          needs_shipping: needsShipping,
        });
      }

      return jsonNoStore({
        success: true,
        ref_id: refId,
        code,
        order_id: paidOrder.id,
        needs_shipping: needsShipping,
        shipment_created: shipment.created === true,
        shipment_missing_address: shipment.missing_address === true,
      });
    }

    await query(
      "UPDATE public.orders SET status = 'failed' WHERE id = $1 AND status = 'pending'",
      [order.id]
    );
    console.error("[api/functions/payment-verify] Verification failed:", code, gatewayResult);
    return jsonNoStore({
      success: false,
      error: ZP_ERRORS[code] ?? "پرداخت تأیید نشد",
      code,
    }, 402);
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith("Missing server environment variable:");
    console.error("[api/functions/payment-verify] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس پرداخت تنظیم نشده است" : "خطا در پردازش پرداخت" },
      missingConfig ? 503 : 500
    );
  }
}
