import { createDatabase } from "../../../../lib/database.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function readEnv(name) {
    return process.env[name];
}
const MERCHANT_ID = (readEnv("ZARINPAL_MERCHANT_ID") ?? "").trim();
const SANDBOX_FLAG = (readEnv("ZARINPAL_SANDBOX") ?? "false").trim().toLowerCase() === "true";
const CALLBACK_URL = (readEnv("ZARINPAL_CALLBACK_URL") ?? "").trim();
const PRICE_TO_RIAL = Number(readEnv("PRICE_TO_RIAL_FACTOR") ?? "10");
const CART_TABLE = "cart_items";
const TEST_MERCHANT_IDS = new Set([
    "00000000-0000-0000-0000-000000000000",
    "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"
]);
const MERCHANT_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
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
    "-54": "شناسه‌ی تراکنش نامعتبر یا منقضی است"
};
async function hashText(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf)).map((b)=>b.toString(16).padStart(2, "0")).join("");
}
async function getSessionUser(token) {
    const tokenHash = await hashText(token);
    const { data: session } = await database.from("user_sessions").select("*").eq("token_hash", tokenHash).eq("is_active", true).maybeSingle();
    if (!session) return null;
    if (new Date(session.expires_at) < new Date()) {
        await database.from("user_sessions").update({
            is_active: false
        }).eq("id", session.id);
        return null;
    }
    const { data: user } = await database.from("site_users").select("id, phone, first_name, last_name").eq("id", session.user_id).maybeSingle();
    return user ?? null;
}
function toLocalMobile(phone) {
    if (phone && phone.startsWith("98") && phone.length === 12) {
        return "0" + phone.substring(2);
    }
    return phone;
}
function isPhysicalCourse(course) {
    if (!course) return false;
    if (course.requires_shipping === true) return true;
    const type = String(course.type ?? "").trim().toLowerCase();
    return type === "book" || type === "lecture";
}
function gatewayConfig() {
    const isTestMerchant = TEST_MERCHANT_IDS.has(MERCHANT_ID.toLowerCase());
    const merchantLooksValid = MERCHANT_RE.test(MERCHANT_ID);
    if (!merchantLooksValid) {
        return {
            ok: false,
            error: "درگاه پرداخت پیکربندی نشده است. مقدار secret با نام ZARINPAL_MERCHANT_ID را با مرچنت‌کد ۳۶ کاراکتری زرین‌پال تنظیم کنید."
        };
    }
    const sandbox = SANDBOX_FLAG || isTestMerchant;
    if (!sandbox && !/^https:\/\//i.test(CALLBACK_URL)) {
        return {
            ok: false,
            error: "آدرس بازگشت (ZARINPAL_CALLBACK_URL) برای درگاه واقعی باید یک آدرس https عمومی باشد؛ مثال: https://example.com/payment-result"
        };
    }
    if (sandbox && !CALLBACK_URL) {
        return {
            ok: false,
            error: "آدرس بازگشت (ZARINPAL_CALLBACK_URL) پیکربندی نشده است"
        };
    }
    return {
        ok: true,
        sandbox,
        base: sandbox ? ZP_SANDBOX_BASE : ZP_PROD_BASE,
        merchant_id: MERCHANT_ID
    };
}
export async function POST(req) {
    try {
        const { token, course_id, address_confirmed } = await req.json();
        if (!token) return jsonResponse({
            error: "توکن ارسال نشده"
        }, 401);
        const gateway = gatewayConfig();
        if (!gateway.ok) {
            console.error("[payment-request] gateway misconfigured:", gateway.error);
            return jsonResponse({
                error: gateway.error,
                gateway_configured: false
            }, 500);
        }
        if (gateway.sandbox) {
            console.warn("[payment-request] ⚠️ در حال اجرا در حالت سندباکس (آزمایشی) زرین‌پال");
        }
        const user = await getSessionUser(token);
        if (!user) return jsonResponse({
            error: "نشست معتبر نیست"
        }, 401);
        const { data: paidOrders } = await database.from("orders").select("course_ids").eq("user_id", String(user.id)).eq("status", "paid");
        const owned = new Set((paidOrders ?? []).flatMap((o)=>o.course_ids ?? []));
        let items = [];
        let source = "cart";
        const effectivePrice = (c)=>Number(c.discount_price != null && Number(c.discount_price) > 0 ? c.discount_price : c.price ?? 0);
        if (course_id) {
            source = "direct";
            const { data: course } = await database.from("courses").select("id, title, type, price, discount_price, requires_shipping").eq("id", course_id).maybeSingle();
            if (!course) return jsonResponse({
                error: "دوره پیدا نشد"
            }, 404);
            if (owned.has(String(course.id))) return jsonResponse({
                error: "این دوره قبلاً خریداری شده است"
            }, 409);
            items = [
                {
                    course_id: course.id,
                    title: course.title,
                    unit_price: effectivePrice(course),
                    type: course.type ?? "course",
                    requires_shipping: isPhysicalCourse(course)
                }
            ];
        } else {
            const { data: rows, error: cartErr } = await database.from(CART_TABLE).select("id, course_id, courses(id, title, type, price, discount_price, requires_shipping)").eq("user_id", user.id);
            if (cartErr) {
                console.error(cartErr);
                return jsonResponse({
                    error: "خطا در خواندن سبد خرید"
                }, 500);
            }
            items = (rows ?? []).filter((r)=>r.courses && !owned.has(String(r.courses.id))).map((r)=>({
                    course_id: r.courses.id,
                    title: r.courses.title,
                    unit_price: effectivePrice(r.courses),
                    type: r.courses.type ?? "course",
                    requires_shipping: isPhysicalCourse(r.courses)
                }));
        }
        if (items.length === 0) return jsonResponse({
            error: "آیتمی برای پرداخت وجود ندارد؛ شاید همه را قبلاً خریده‌اید"
        }, 400);
        const hasPhysical = items.some((i)=>i.requires_shipping === true);
        if (hasPhysical) {
            const { data: addr } = await database.from("user_addresses").select("user_id").eq("user_id", String(user.id)).maybeSingle();
            if (!addr || !address_confirmed) {
                return jsonResponse({
                    error: "این سفارش شامل محصول فیزیکی است؛ لطفاً ابتدا نشانی ارسال را بررسی و ثبت کنید",
                    needs_address: true
                }, 400);
            }
        }
        const amountRial = Math.round(items.reduce((sum, i)=>sum + i.unit_price, 0) * PRICE_TO_RIAL);
        if (amountRial < 1000) return jsonResponse({
            error: "مبلغ قابل پرداخت معتبر نیست"
        }, 400);
        const snapshot = items.map((i)=>({
                course_id: i.course_id,
                title: i.title,
                type: i.type,
                unit_price_rial: i.unit_price * PRICE_TO_RIAL,
                requires_shipping: i.requires_shipping === true
            }));
        const { data: order, error: orderErr } = await database.from("orders").insert({
            user_id: String(user.id),
            amount_rial: amountRial,
            description: `خرید ${snapshot.length} محصول آموزشی — آکادمی استاد مهدی عزیزی`,
            status: "init",
            source,
            items: snapshot,
            course_ids: snapshot.map((i)=>String(i.course_id))
        }).select("id").single();
        if (orderErr) {
            console.error(orderErr);
            return jsonResponse({
                error: "خطا در ساخت سفارش"
            }, 500);
        }
        const zpRes = await fetch(`${gateway.base}/v4/payment/request.json`, {
            method: "POST",
            signal: AbortSignal.timeout(15000),
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
            },
            body: JSON.stringify({
                merchant_id: gateway.merchant_id,
                amount: amountRial,
                callback_url: CALLBACK_URL,
                description: `خرید ${snapshot.length} محصول آموزشی`,
                metadata: {
                    mobile: toLocalMobile(user.phone ?? ""),
                    order_id: String(order.id)
                }
            })
        });
        const zp = await zpRes.json();
        const code = zp?.data?.code ?? zp?.errors?.code;
        if (code !== 100) {
            await database.from("orders").update({
                status: "failed"
            }).eq("id", order.id);
            console.error("[payment-request] zarinpal error", code, zp);
            return jsonResponse({
                error: ZP_ERRORS[code] ?? "خطا در اتصال به درگاه پرداخت",
                code,
                sandbox: gateway.sandbox
            }, 502);
        }
        const authority = zp.data.authority;
        if (typeof authority !== "string" || !authority) return jsonResponse({ error: "شناسهٔ پرداخت نامعتبر است" }, 502);
        const { error: saveError } = await database.from("orders").update({
            status: "pending",
            authority
        }).eq("id", order.id);
        if (saveError) {
            console.error("[payment-request] authority save failed:", saveError);
            return jsonResponse({ error: "خطا در ذخیرهٔ شناسهٔ پرداخت" }, 503);
        }
        return jsonResponse({
            success: true,
            pay_url: `${gateway.base}/StartPay/${authority}`,
            authority,
            sandbox: gateway.sandbox,
            needs_shipping: hasPhysical
        });
    } catch (error) {
        console.error(error);
        return jsonResponse({
            error: error?.message ?? "خطای سرور"
        }, 500);
    }
}
