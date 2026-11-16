import { createDatabase } from "../../../../lib/database.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function readEnv(name) {
    return process.env[name];
}
const MERCHANT_ID = (readEnv("ZARINPAL_MERCHANT_ID") ?? "").trim();
const SANDBOX_FLAG = (readEnv("ZARINPAL_SANDBOX") ?? "false").trim().toLowerCase() === "true";
const CART_TABLE = "cart_items";
const TEST_MERCHANT_IDS = new Set([
    "00000000-0000-0000-0000-000000000000",
    "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"
]);
const ZP_PROD_BASE = "https://payment.zarinpal.com/pg";
const ZP_SANDBOX_BASE = "https://sandbox.zarinpal.com/pg";
const database = createDatabase();
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json"
        }
    });
}
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
    "-54": "شناسه‌ی تراکنش نامعتبر یا منقضی است"
};
const ENV_MISMATCH_CODES = new Set([
    -9,
    -10,
    -11,
    -15,
    -16,
    -53,
    -54
]);
function isPhysicalCourse(course) {
    if (!course) return false;
    if (course.requires_shipping === true) return true;
    const type = String(course.type ?? "").trim().toLowerCase();
    return type === "book" || type === "lecture";
}
async function orderNeedsShipping(order) {
    const items = Array.isArray(order?.items) ? order.items : [];
    if (items.some((i)=>i?.requires_shipping === true)) return true;
    if (items.length > 0 && items.every((i)=>i?.requires_shipping === false) && items.some((i)=>i?.type)) {
        return false;
    }
    const courseIds = Array.isArray(order?.course_ids) ? order.course_ids : [];
    if (courseIds.length === 0) return false;
    let { data: courses, error } = await database.from("courses").select("id, type, requires_shipping").in("id", courseIds);
    if (error) {
        const retry = await database.from("courses").select("id, type").in("id", courseIds);
        courses = retry.data;
    }
    return (courses ?? []).some((c)=>isPhysicalCourse(c));
}
async function ensureShipment(order) {
    try {
        const { data: existing, error: selErr } = await database.from("shipments").select("id, status").eq("order_id", String(order.id)).limit(1);
        if (!selErr && existing && existing.length > 0) {
            return {
                created: false,
                shipment_id: existing[0].id
            };
        }
        if (selErr) console.error("[payment-verify] shipments select:", selErr);
        const { data: addr, error: addrErr } = await database.from("user_addresses").select("*").eq("user_id", String(order.user_id)).maybeSingle();
        if (addrErr) console.error("[payment-verify] address select:", addrErr);
        if (!addr) {
            console.error(`[payment-verify] سفارش ${order.id} نیاز به ارسال پستی دارد ولی نشانی کاربر ${order.user_id} ثبت نشده است`);
            return {
                created: false,
                shipment_id: null,
                missing_address: true
            };
        }
        const now = new Date().toISOString();
        const { data: inserted, error: insErr } = await database.from("shipments").insert({
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
            updated_at: now
        }).select("id").maybeSingle();
        if (insErr) {
            console.error("[payment-verify] shipment insert failed:", insErr);
            return {
                created: false,
                shipment_id: null,
                error: insErr.message
            };
        }
        console.log(`[payment-verify] ✅ مرسوله‌ی پستی برای سفارش ${order.id} ساخته شد`);
        return {
            created: true,
            shipment_id: inserted?.id ?? null
        };
    } catch (e) {
        console.error("[payment-verify] ensureShipment crashed:", e);
        return {
            created: false,
            shipment_id: null
        };
    }
}
async function verifyWithBase(base, authority, amount) {
    const res = await fetch(`${base}/v4/payment/verify.json`, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
        },
        body: JSON.stringify({
            merchant_id: MERCHANT_ID,
            amount,
            authority
        })
    });
    const payload = await res.json().catch(()=>({}));
    const code = payload?.data?.code ?? payload?.errors?.code ?? null;
    return {
        payload,
        code
    };
}
export async function POST(req) {
    try {
        const { authority } = await req.json();
        if (!authority) return jsonResponse({
            error: "شناسه‌ی تراکنش ارسال نشده"
        }, 400);
        if (!MERCHANT_ID) return jsonResponse({
            error: "درگاه پرداخت پیکربندی نشده است؛ secret با نام ZARINPAL_MERCHANT_ID تنظیم نشده"
        }, 500);
        const { data: order } = await database.from("orders").select("*").eq("authority", authority).maybeSingle();
        if (!order) return jsonResponse({
            error: "سفارش پیدا نشد"
        }, 404);
        if (order.status === "paid") {
            const needsShipping = await orderNeedsShipping(order);
            if (needsShipping) await ensureShipment(order);
            return jsonResponse({
                success: true,
                ref_id: order.ref_id,
                already: true,
                order_id: order.id,
                needs_shipping: needsShipping
            });
        }
        if (order.status !== "pending") {
            return jsonResponse({
                error: "این تراکنش قابل تأیید نیست",
                status: order.status
            }, 400);
        }
        const isTestMerchant = TEST_MERCHANT_IDS.has(MERCHANT_ID.toLowerCase());
        const sandbox = SANDBOX_FLAG || isTestMerchant;
        const sandboxAuthority = /^s/i.test(String(authority));
        let firstBase = sandbox ? ZP_SANDBOX_BASE : ZP_PROD_BASE;
        let secondBase = sandbox ? ZP_PROD_BASE : ZP_SANDBOX_BASE;
        if (sandboxAuthority && !sandbox) {
            firstBase = ZP_SANDBOX_BASE;
            secondBase = ZP_PROD_BASE;
        }
        let { payload: zp, code } = await verifyWithBase(firstBase, authority, order.amount_rial);
        if (code !== 100 && code !== 101 && ENV_MISMATCH_CODES.has(Number(code))) {
            console.warn(`[payment-verify] code=${code} روی ${firstBase}؛ تلاش دوباره روی ${secondBase}`);
            const retry = await verifyWithBase(secondBase, authority, order.amount_rial);
            if (retry.code === 100 || retry.code === 101) {
                zp = retry.payload;
                code = retry.code;
            }
        }
        if (code === 100 || code === 101) {
            const refId = zp?.data?.ref_id ?? null;
            const cardPan = zp?.data?.card_pan ?? null;
            const { data: updated, error: updateError } = await database.from("orders").update({
                status: "paid",
                ref_id: refId,
                card_pan: cardPan,
                verified_at: new Date().toISOString()
            }).eq("id", order.id).eq("status", "pending").select("id");
            if (updateError) return jsonResponse({ error: "ثبت نتیجهٔ پرداخت انجام نشد. دوباره تلاش کنید." }, 503);
            const needsShipping = await orderNeedsShipping(order);
            if (!updated || updated.length === 0) {
                const { data: fresh } = await database.from("orders").select("ref_id,status").eq("id", order.id).single();
                if (fresh?.status !== "paid") return jsonResponse({ error: "ثبت نتیجهٔ پرداخت انجام نشد. دوباره تلاش کنید." }, 503);
                if (needsShipping) await ensureShipment(order);
                return jsonResponse({
                    success: true,
                    ref_id: fresh?.ref_id ?? refId,
                    already: true,
                    order_id: order.id,
                    needs_shipping: needsShipping
                });
            }
            const items = Array.isArray(order.items) ? order.items : [];
            const courseIds = items.map((i)=>i.course_id).filter((v)=>v != null);
            if (order.source === "cart" && courseIds.length > 0) {
                await database.from(CART_TABLE).delete().eq("user_id", order.user_id).in("course_id", courseIds);
            }
            let shipment = {
                created: false,
                shipment_id: null
            };
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
                shipment_missing_address: shipment.missing_address === true
            });
        }
        console.error("[payment-verify] verify failed", code, zp);
        return jsonResponse({
            success: false,
            error: ZP_ERRORS[code] ?? "پرداخت تأیید نشد",
            code
        }, 402);
    } catch (error) {
        console.error(error);
        return jsonResponse({
            error: error?.message ?? "خطای سرور"
        }, 500);
    }
}
