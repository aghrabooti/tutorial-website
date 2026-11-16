import { randomInt } from "node:crypto";
import { createDatabase } from "../../../../lib/database.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function readEnv(name) {
    return process.env[name];
}
const database = createDatabase();
function secret(...names) {
    for (const name of names){
        const value = (readEnv(name) ?? "").trim();
        if (value) return value;
    }
    return "";
}
const SMSIR_API_KEY = secret("SMS_IR_API_KEY", "SMSIR_API_KEY");
const SMSIR_TEMPLATE_ID = secret("SMS_IR_TEMPLATE_ID", "SMSIR_TEMPLATE_ID");
const SMSIR_LINE_NUMBER = secret("SMS_IR_LINE_NUMBER", "SMSIR_LINE_NUMBER");
const SMSIR_OTP_PARAMETER = secret("SMS_IR_OTP_PARAMETER", "SMSIR_OTP_PARAMETER").replace(/^#+|#+$/g, "") || "CODE";
const KAVENEGAR_API_KEY = secret("KAVENEGAR_API_KEY");
const OTP_DEBUG = process.env.NODE_ENV !== "production" && /^(1|true|yes|on)$/i.test((readEnv("OTP_DEBUG") ?? "").trim());
const OTP_EXPIRE_MINUTES = 2;
const OTP_COOLDOWN_SECONDS = Number(readEnv("OTP_COOLDOWN_SECONDS") ?? "") || 60;
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json"
        }
    });
}
async function hashText(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer)).map((b)=>b.toString(16).padStart(2, "0")).join("");
}
function normalizePhone(phone) {
    phone = String(phone ?? "").trim().replace(/\s+/g, "");
    if (phone.startsWith("09")) {
        phone = "98" + phone.substring(1);
    }
    if (phone.startsWith("+98")) {
        phone = phone.substring(1);
    }
    return phone;
}
function toLocalMobile(phone) {
    return phone.startsWith("98") && phone.length === 12 ? "0" + phone.substring(2) : phone;
}
function toSmsIrMobile(phone) {
    return phone.startsWith("98") && phone.length === 12 ? phone.substring(2) : phone.replace(/^0/, "");
}
const SMSIR_HINTS = {
    "0": "خطای موقت سامانه‌ی sms.ir — چند دقیقه بعد دوباره امتحان کنید",
    "10": "کلید وب‌سرویس sms.ir نامعتبر است (سکرت SMSIR_API_KEY را دوباره از پنل کپی کنید)",
    "11": "کلید وب‌سرویس sms.ir غیرفعال است (پنل → برنامه‌نویسان → کلیدهای API)",
    "12": "کلید sms.ir فقط برای IPهای مشخصی مجاز شده است — محدودیت IP را در پنل بردارید",
    "13": "حساب sms.ir غیرفعال است",
    "14": "حساب sms.ir در حالت تعلیق قرار دارد",
    "15": "برای استفاده از وب‌سرویس sms.ir باید پلن حساب را ارتقا دهید",
    "16": "یکی از مقادیر ارسالی به sms.ir نادرست است",
    "20": "تعداد درخواست‌ها به sms.ir بیش از حد مجاز است — کمی بعد دوباره امتحان کنید",
    "101": "شماره‌ی خط ارسال نامعتبر است",
    "102": "اعتبار پنل sms.ir کافی نیست — حساب را شارژ کنید",
    "104": "شماره‌ی موبایل برای sms.ir نادرست است",
    "113": "قالب پیامکی در sms.ir پیدا نشد — سکرت SMSIR_TEMPLATE_ID را بررسی کنید",
    "114": "مقدار پارامتر قالب در sms.ir بیش از ۲۵ کاراکتر است",
    "115": "این شماره‌ی موبایل در لیست سیاه sms.ir است",
    "116": "نام پارامتر قالب در sms.ir خالی یا نادرست است (سکرت SMSIR_OTP_PARAMETER)",
    "117": "متن قالب sms.ir هنوز تأیید نشده است",
    "118": "تعداد پیام‌های ارسالی بیش از حد مجاز است",
    "119": "قالب شخصی‌سازی‌شده نیاز به ارتقای پلن sms.ir دارد",
    "123": "خط ارسال‌کننده در sms.ir نیاز به فعال‌سازی دارد — با پشتیبانی sms.ir تماس بگیرید",
    "124": "قالب انتخابی در sms.ir به‌عنوان قالب کد تأیید (OTP) شناسایی نشده است"
};
function smsirError(mode, data, fallbackText) {
    const status = data && typeof data.status === "number" ? Number(data.status) : null;
    const message = String(data?.message ?? fallbackText ?? "").trim();
    return {
        ok: false,
        provider: "smsir",
        mode,
        status,
        message,
        hint: status !== null && SMSIR_HINTS[String(status)] || message || fallbackText
    };
}
async function sendSmsIrVerify(phone, otp) {
    const trySend = async (mobile)=>{
        const res = await fetch("https://api.sms.ir/v1/send/verify", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "text/plain",
                "x-api-key": SMSIR_API_KEY
            },
            body: JSON.stringify({
                mobile,
                templateId: Number(SMSIR_TEMPLATE_ID),
                parameters: [
                    {
                        name: SMSIR_OTP_PARAMETER,
                        value: otp
                    }
                ]
            })
        });
        const data = await res.json().catch(()=>null);
        if (res.ok && data?.status === 1) {
            return {
                ok: true,
                provider: "smsir",
                mode: "verify",
                status: 1,
                message: String(data?.message ?? "موفق"),
                messageId: data?.data?.messageId ?? null
            };
        }
        return smsirError("verify", data, `پاسخ نامعتبر از sms.ir (HTTP ${res.status})`);
    };
    let out = await trySend(toSmsIrMobile(phone));
    if (!out.ok && out.status === 104) {
        const alt = await trySend(toLocalMobile(phone));
        if (alt.ok) return alt;
    }
    return out;
}
async function sendSmsIrBulk(phone, otp) {
    const message = `کد تأیید شما در آکادمی استاد مهدی عزیزی: ${otp}`;
    const trySend = async (mobile)=>{
        const res = await fetch("https://api.sms.ir/v1/send/bulk", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "text/plain",
                "x-api-key": SMSIR_API_KEY
            },
            body: JSON.stringify({
                lineNumber: Number(SMSIR_LINE_NUMBER),
                messageText: message,
                mobiles: [
                    mobile
                ]
            })
        });
        const data = await res.json().catch(()=>null);
        if (res.ok && data?.status === 1) {
            return {
                ok: true,
                provider: "smsir",
                mode: "bulk",
                status: 1,
                message: String(data?.message ?? "موفق"),
                packId: data?.data?.packId ?? null,
                messageId: data?.data?.messageIds?.[0] ?? null
            };
        }
        return smsirError("bulk", data, `پاسخ نامعتبر از sms.ir (HTTP ${res.status})`);
    };
    let out = await trySend(toSmsIrMobile(phone));
    if (!out.ok && out.status === 104) {
        const alt = await trySend(toLocalMobile(phone));
        if (alt.ok) return alt;
    }
    return out;
}
async function sendKavenegar(phone, otp) {
    const message = `کد تأیید شما در آکادمی استاد مهدی عزیزی: ${otp}`;
    try {
        const res = await fetch(`https://api.kavenegar.com/v1/${KAVENEGAR_API_KEY}/sms/send.json`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                receptor: toLocalMobile(phone),
                message
            }).toString()
        });
        const data = await res.json().catch(()=>null);
        if (!res.ok || data?.return?.status !== 200) {
            console.error("kavenegar error", data);
            return {
                ok: false,
                provider: "kavenegar",
                status: Number(data?.return?.status ?? res.status) || null,
                message: String(data?.return?.message ?? ""),
                hint: "اعتبار پنل و تأیید خط ارسال کاوه‌نگار را بررسی کنید"
            };
        }
        return {
            ok: true,
            provider: "kavenegar",
            status: 200,
            message: "موفق"
        };
    } catch (e) {
        console.error("kavenegar fetch failed", e);
        return {
            ok: false,
            provider: "kavenegar",
            message: String(e?.message ?? e),
            hint: "ارتباط با سرور کاوه‌نگار برقرار نشد"
        };
    }
}
function activeProvider() {
    if (SMSIR_API_KEY) return "smsir";
    if (KAVENEGAR_API_KEY) return "kavenegar";
    return "none";
}
async function sendSms(phone, otp) {
    const provider = activeProvider();
    if (provider === "smsir") {
        if (SMSIR_TEMPLATE_ID && /^\d+$/.test(SMSIR_TEMPLATE_ID)) {
            return sendSmsIrVerify(phone, otp);
        }
        if (SMSIR_LINE_NUMBER && /^\d+$/.test(SMSIR_LINE_NUMBER)) {
            return sendSmsIrBulk(phone, otp);
        }
        return {
            ok: false,
            provider: "smsir",
            config_missing: true,
            missing_secret: "SMS_IR_TEMPLATE_ID",
            message: "سکرت SMS_IR_TEMPLATE_ID (شناسه‌ی قالب کد تأیید) تنظیم نشده است",
            hint: "در پنل sms.ir یک قالب با متن شامل #CODE# بسازید و شناسه‌اش را در فایل تنظیمات سرور با نام SMS_IR_TEMPLATE_ID ذخیره کنید (یا به‌جای قالب، سکرت SMS_IR_LINE_NUMBER را تنظیم کنید)"
        };
    }
    if (provider === "kavenegar") {
        return sendKavenegar(phone, otp);
    }
    return {
        ok: false,
        provider: "none"
    };
}
export async function POST(req) {
    try {
        const body = await req.json();
        let phone = body.phone;
        if (!phone) {
            return jsonResponse({
                error: "شماره موبایل ارسال نشده"
            }, 400);
        }
        phone = normalizePhone(phone);
        if (!/^989\d{9}$/.test(phone)) {
            return jsonResponse({
                error: "شماره موبایل معتبر نیست"
            }, 400);
        }
        if (activeProvider() === "none" && !OTP_DEBUG) {
            return jsonResponse({ error: "سرویس پیامک تنظیم نشده است" }, 503);
        }
        const otp = String(randomInt(100000, 1000000));
        const otpHash = await hashText(otp);
        const { data: wait, error } = await database.rpc("reserve_registration_otp", {
            p_phone: phone,
            p_code_hash: otpHash,
            p_lifetime: OTP_EXPIRE_MINUTES * 60,
            p_cooldown: OTP_COOLDOWN_SECONDS,
        });
        if (wait > 0) {
            return jsonResponse({
                error: `تا ${wait} ثانیه‌ی دیگر صبر کنید و دوباره امتحان کنید`,
                retry_after: wait,
                cooldown: true,
            }, 429);
        }
        if (error) {
            console.error(error);
            return jsonResponse({
                error: "خطا در ذخیره OTP"
            }, 500);
        }
        if (activeProvider() !== "none") {
            const sent = await sendSms(phone, otp);
            if (!sent.ok) {
                await database.from("otp_codes").delete().eq("phone", phone).eq("code_hash", otpHash);
                console.error("sms failed", JSON.stringify(sent));
                return jsonResponse({
                    error: `ارسال پیامک ناموفق بود — ${sent.hint ?? sent.message ?? "خطای نامشخص"}`,
                    sms_failed: true,
                    provider: sent.provider,
                    sms_mode: sent.mode ?? null,
                    sms_status: sent.status ?? null,
                    sms_message: sent.message ?? null,
                    sms_config_missing: sent.config_missing === true,
                    missing_secret: sent.missing_secret ?? null
                }, 502);
            }
            const payload = {
                success: true,
                message: "کد تأیید پیامک شد",
                sent_via_sms: true,
                provider: sent.provider,
                sms_mode: sent.mode ?? null,
                message_id: sent.messageId ?? null,
                expires_in: OTP_EXPIRE_MINUTES * 60
            };
            if (OTP_DEBUG) {
                payload.debug_code = otp;
                payload.debug = true;
                payload.warning = "OTP_DEBUG روشن است — بعد از تست، این سکرت را حذف کنید";
            }
            return jsonResponse(payload);
        }
        return jsonResponse({
            success: true,
            message: "OTP ساخته شد (حالت توسعه)",
            debug_code: otp,
            dev_mode: true,
            sms_configured: false,
            provider: "none",
            expires_in: OTP_EXPIRE_MINUTES * 60
        });
    } catch (error) {
        console.error(error);
        return jsonResponse({
            error: error?.message ?? "خطای سرور"
        }, 500);
    }
}
