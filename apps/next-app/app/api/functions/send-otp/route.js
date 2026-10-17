import { createHash, randomInt } from "node:crypto";
import { jsonNoStore } from "../../../../lib/session-token.js";
import { normalizePhone } from "../../../../lib/phone.js";
import { query, withTransaction } from "../../../../lib/postgres.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OTP_EXPIRE_MINUTES = 2;
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
  "113": "قالب پیامکی در sms.ir پیدا نشد — سکرت SMS_IR_TEMPLATE_ID را بررسی کنید",
  "114": "مقدار پارامتر قالب در sms.ir بیش از ۲۵ کاراکتر است",
  "115": "این شماره‌ی موبایل در لیست سیاه sms.ir است",
  "116": "نام پارامتر قالب در sms.ir خالی یا نادرست است (سکرت SMS_IR_OTP_PARAMETER)",
  "117": "متن قالب sms.ir هنوز تأیید نشده است",
  "118": "تعداد پیام‌های ارسالی بیش از حد مجاز است",
  "119": "قالب شخصی‌سازی‌شده نیاز به ارتقای پلن sms.ir دارد",
  "123": "خط ارسال‌کننده در sms.ir نیاز به فعال‌سازی دارد — با پشتیبانی sms.ir تماس بگیرید",
  "124": "قالب انتخابی در sms.ir به‌عنوان قالب کد تأیید (OTP) شناسایی نشده است",
};

function secret(...names) {
  for (const name of names) {
    const value = (process.env[name] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function hashText(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function toLocalMobile(phone) {
  return phone.startsWith("98") && phone.length === 12
    ? `0${phone.substring(2)}`
    : phone;
}

function toSmsIrMobile(phone) {
  return phone.startsWith("98") && phone.length === 12
    ? phone.substring(2)
    : phone.replace(/^0/, "");
}

function smsirError(mode, data, fallbackText) {
  const status = data && typeof data.status === "number" ? Number(data.status) : null;
  const message = String(data?.message ?? fallbackText ?? "").trim();
  return {
    ok: false,
    provider: "smsir",
    mode,
    status,
    message,
    hint: (status !== null && SMSIR_HINTS[String(status)]) || message || fallbackText,
  };
}

async function sendSmsIrVerify(phone, otp, apiKey, templateId, parameterName) {
  const trySend = async (mobile) => {
    const response = await fetch("https://api.sms.ir/v1/send/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/plain",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        mobile,
        templateId: Number(templateId),
        parameters: [{ name: parameterName, value: otp }],
      }),
    });
    const data = await response.json().catch(() => null);
    if (response.ok && data?.status === 1) {
      return {
        ok: true,
        provider: "smsir",
        mode: "verify",
        status: 1,
        message: String(data?.message ?? "موفق"),
        messageId: data?.data?.messageId ?? null,
      };
    }
    return smsirError("verify", data, `پاسخ نامعتبر از sms.ir (HTTP ${response.status})`);
  };

  const first = await trySend(toSmsIrMobile(phone));
  if (!first.ok && first.status === 104) {
    const alternate = await trySend(toLocalMobile(phone));
    if (alternate.ok) return alternate;
  }
  return first;
}

async function sendSmsIrBulk(phone, otp, apiKey, lineNumber) {
  const message = `کد تأیید شما در آکادمی استاد مهدی عزیزی: ${otp}`;
  const trySend = async (mobile) => {
    const response = await fetch("https://api.sms.ir/v1/send/bulk", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/plain",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        lineNumber: Number(lineNumber),
        messageText: message,
        mobiles: [mobile],
      }),
    });
    const data = await response.json().catch(() => null);
    if (response.ok && data?.status === 1) {
      return {
        ok: true,
        provider: "smsir",
        mode: "bulk",
        status: 1,
        message: String(data?.message ?? "موفق"),
        packId: data?.data?.packId ?? null,
        messageId: data?.data?.messageIds?.[0] ?? null,
      };
    }
    return smsirError("bulk", data, `پاسخ نامعتبر از sms.ir (HTTP ${response.status})`);
  };

  const first = await trySend(toSmsIrMobile(phone));
  if (!first.ok && first.status === 104) {
    const alternate = await trySend(toLocalMobile(phone));
    if (alternate.ok) return alternate;
  }
  return first;
}

async function sendKavenegar(phone, otp, apiKey) {
  const message = `کد تأیید شما در آکادمی استاد مهدی عزیزی: ${otp}`;
  try {
    const response = await fetch(
      `https://api.kavenegar.com/v1/${encodeURIComponent(apiKey)}/sms/send.json`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ receptor: toLocalMobile(phone), message }).toString(),
      }
    );
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.return?.status !== 200) {
      console.error("[api/functions/send-otp] Kavenegar error:", data);
      return {
        ok: false,
        provider: "kavenegar",
        status: Number(data?.return?.status ?? response.status) || null,
        message: String(data?.return?.message ?? ""),
        hint: "اعتبار پنل و تأیید خط ارسال کاوه‌نگار را بررسی کنید",
      };
    }
    return { ok: true, provider: "kavenegar", status: 200, message: "موفق" };
  } catch (error) {
    console.error("[api/functions/send-otp] Kavenegar request failed:", error);
    return {
      ok: false,
      provider: "kavenegar",
      message: String(error?.message ?? error),
      hint: "ارتباط با سرور کاوه‌نگار برقرار نشد",
    };
  }
}

async function sendSms(phone, otp) {
  const smsIrKey = secret("SMS_IR_API_KEY", "SMSIR_API_KEY");
  const templateId = secret("SMS_IR_TEMPLATE_ID", "SMSIR_TEMPLATE_ID");
  const lineNumber = secret("SMS_IR_LINE_NUMBER", "SMSIR_LINE_NUMBER");
  const parameterName = secret("SMS_IR_OTP_PARAMETER", "SMSIR_OTP_PARAMETER")
    .replace(/^#+|#+$/g, "") || "CODE";
  const kavenegarKey = secret("KAVENEGAR_API_KEY");

  if (smsIrKey) {
    if (templateId && /^\d+$/.test(templateId)) {
      return sendSmsIrVerify(phone, otp, smsIrKey, templateId, parameterName);
    }
    if (lineNumber && /^\d+$/.test(lineNumber)) {
      return sendSmsIrBulk(phone, otp, smsIrKey, lineNumber);
    }
    return {
      ok: false,
      provider: "smsir",
      config_missing: true,
      missing_secret: "SMS_IR_TEMPLATE_ID",
      message: "سکرت SMS_IR_TEMPLATE_ID (شناسه‌ی قالب کد تأیید) تنظیم نشده است",
      hint: "در پنل sms.ir یک قالب با متن شامل #CODE# بسازید و شناسه‌اش را در متغیر SMS_IR_TEMPLATE_ID محیط Next تنظیم کنید (یا به‌جای قالب، SMS_IR_LINE_NUMBER را تنظیم کنید)",
    };
  }

  if (kavenegarKey) return sendKavenegar(phone, otp, kavenegarKey);
  return { ok: false, provider: "none" };
}

function providerConfigured() {
  return Boolean(secret("SMS_IR_API_KEY", "SMSIR_API_KEY") || secret("KAVENEGAR_API_KEY"));
}

function getCooldownSeconds() {
  const configured = Number(process.env.OTP_COOLDOWN_SECONDS ?? "");
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 60;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "درخواست نامعتبر است" }, 400);
  }

  let phone = body?.phone;
  if (!phone) return jsonNoStore({ error: "شماره موبایل ارسال نشده" }, 400);
  phone = normalizePhone(phone);
  if (!/^989\d{9}$/.test(phone)) {
    return jsonNoStore({ error: "شماره موبایل معتبر نیست" }, 400);
  }
  if (!providerConfigured() && process.env.NODE_ENV === "production") {
    return jsonNoStore({
      error: "سامانه‌ی پیامک تنظیم نشده است؛ متغیر SMS_IR_API_KEY یا KAVENEGAR_API_KEY را در سرور تنظیم کنید",
      sms_config_missing: true,
    }, 503);
  }

  try {
    const otp = String(randomInt(100_000, 1_000_000));
    const codeHash = hashText(otp);
    const otpId = await withTransaction(async (client) => {
      // Serialize concurrent requests for this phone/purpose so the cooldown
      // cannot be bypassed by simultaneous requests.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [phone, "register"]
      );
      const { rows: recentRows } = await client.query(
        `SELECT created_at FROM public.otp_codes
         WHERE phone = $1 AND purpose = $2
         ORDER BY created_at DESC LIMIT 1`,
        [phone, "register"]
      );
      const lastOtp = recentRows[0] ?? null;
      const cooldownSeconds = getCooldownSeconds();
      if (lastOtp) {
        const diff = (Date.now() - new Date(lastOtp.created_at).getTime()) / 1000;
        if (diff < cooldownSeconds) {
          return { cooldown: Math.max(1, Math.ceil(cooldownSeconds - diff)) };
        }
      }

      await client.query(
        "DELETE FROM public.otp_codes WHERE phone = $1 AND purpose = $2",
        [phone, "register"]
      );
      const inserted = await client.query(
        `INSERT INTO public.otp_codes (phone, code_hash, purpose, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [phone, codeHash, "register", new Date(Date.now() + OTP_EXPIRE_MINUTES * 60 * 1000)]
      );
      return { id: inserted.rows[0]?.id };
    });

    if (otpId.cooldown) {
      return jsonNoStore({
        error: `تا ${otpId.cooldown} ثانیه‌ی دیگر صبر کنید و دوباره امتحان کنید`,
        retry_after: otpId.cooldown,
        cooldown: true,
      }, 429);
    }
    if (!otpId.id) throw new Error("OTP insert did not return an id");

    if (providerConfigured()) {
      const sent = await sendSms(phone, otp);
      if (!sent.ok) {
        await query("DELETE FROM public.otp_codes WHERE id = $1", [otpId.id]);
        console.error("[api/functions/send-otp] SMS failed:", JSON.stringify(sent));
        return jsonNoStore({
          error: `ارسال پیامک ناموفق بود — ${sent.hint ?? sent.message ?? "خطای نامشخص"}`,
          sms_failed: true,
          provider: sent.provider,
          sms_mode: sent.mode ?? null,
          sms_status: sent.status ?? null,
          sms_message: sent.message ?? null,
          sms_config_missing: sent.config_missing === true,
          missing_secret: sent.missing_secret ?? null,
        }, 502);
      }

      const payload = {
        success: true,
        message: "کد تأیید پیامک شد",
        sent_via_sms: true,
        provider: sent.provider,
        sms_mode: sent.mode ?? null,
        message_id: sent.messageId ?? null,
        expires_in: OTP_EXPIRE_MINUTES * 60,
      };
      if (
        process.env.NODE_ENV !== "production" &&
        /^(1|true|yes|on)$/i.test((process.env.OTP_DEBUG ?? "").trim())
      ) {
        payload.debug_code = otp;
        payload.debug = true;
        payload.warning = "OTP_DEBUG روشن است — بعد از تست، این متغیر را خاموش کنید";
      }
      return jsonNoStore(payload);
    }

    return jsonNoStore({
      success: true,
      message: "OTP ساخته شد (حالت توسعه)",
      debug_code: otp,
      dev_mode: true,
      sms_configured: false,
      provider: "none",
      expires_in: OTP_EXPIRE_MINUTES * 60,
    });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/send-otp] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس پیامک/OTP تنظیم نشده است" : "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
