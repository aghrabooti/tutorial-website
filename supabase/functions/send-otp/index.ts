// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// send-otp
// ورودی: { phone }
//
// سامانه‌های پیامک به ترتیب اولویت:
//   ۱) sms.ir  → اگر سکرت SMS_IR_API_KEY (یا SMSIR_API_KEY) تنظیم شده باشد
//        • روش «ارسال سریع / Verify»: SMS_IR_TEMPLATE_ID لازم است
//          (قالب باید در پنل sms.ir ساخته شده باشد و شامل #CODE# باشد)
//        • روش «ارسال گروهی / Bulk»: اگر SMS_IR_TEMPLATE_ID نبود ولی
//          SMS_IR_LINE_NUMBER تنظیم بود، متن آزاد با همان خط ارسال می‌شود
//   ۲) کاوه‌نگار → اگر KAVENEGAR_API_KEY تنظیم شده باشد
//   ۳) اگر هیچ‌کدام نبود → «حالت توسعه»: پیامکی ارسال نمی‌شود و کد در
//      debug_code برمی‌گردد (فقط برای تست؛ روی نسخه‌ی واقعی نباید بماند)
//
// وقتی پیامک واقعی ارسال شود، کد هرگز در پاسخ API برنمی‌گردد.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

// ── سکرت‌های سامانه‌ی پیامک ──
// هر دو نام‌گذاری پذیرفته است: SMS_IR_API_KEY و SMSIR_API_KEY
// (هر کدام تنظیم شده باشد، همان خوانده می‌شود)
function secret(...names: string[]) {
  for (const name of names) {
    const value = (Deno.env.get(name) ?? "").trim();
    if (value) return value;
  }
  return "";
}

const SMSIR_API_KEY = secret("SMS_IR_API_KEY", "SMSIR_API_KEY");
const SMSIR_TEMPLATE_ID = secret("SMS_IR_TEMPLATE_ID", "SMSIR_TEMPLATE_ID");
const SMSIR_LINE_NUMBER = secret("SMS_IR_LINE_NUMBER", "SMSIR_LINE_NUMBER");
// نام پارامتر در قالب sms.ir، بدون # (پیش‌فرض: CODE)
const SMSIR_OTP_PARAMETER =
  secret("SMS_IR_OTP_PARAMETER", "SMSIR_OTP_PARAMETER")
    .replace(/^#+|#+$/g, "") || "CODE";

const KAVENEGAR_API_KEY = secret("KAVENEGAR_API_KEY");

// اگر true باشد، حتی وقتی پیامک واقعی ارسال می‌شود کد در پاسخ می‌آید.
// فقط برای تست (مثلاً با کلید Sandbox در sms.ir) — بعد از تست پاکش کنید!
const OTP_DEBUG = /^(1|true|yes|on)$/i.test(
  (Deno.env.get("OTP_DEBUG") ?? "").trim()
);

const OTP_EXPIRE_MINUTES = 2;

// فاصله‌ی مجاز بین دو درخواست همان شماره (قابل تنظیم از Secrets).
// مقدار پیش‌فرض ۶۰ ثانیه است؛ اگر خواستید کوتاه‌تر/بلندتر شود، سکرت
// OTP_COOLDOWN_SECONDS را در Supabase تنظیم کنید.
const OTP_COOLDOWN_SECONDS =
  Number(Deno.env.get("OTP_COOLDOWN_SECONDS") ?? "") || 60;

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

async function hashText(text: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizePhone(phone: string) {
  phone = String(phone ?? "").trim().replace(/\s+/g, "");

  if (phone.startsWith("09")) {
    phone = "98" + phone.substring(1);
  }

  if (phone.startsWith("+98")) {
    phone = phone.substring(1);
  }

  return phone;
}

// 989123456789 → 09123456789 (فرمت کاوه‌نگار و sms.ir)
function toLocalMobile(phone: string) {
  return phone.startsWith("98") && phone.length === 12
    ? "0" + phone.substring(2)
    : phone;
}

// 989123456789 → 9123456789 (فرمت نمونه‌های رسمی sms.ir، بدون صفر)
function toSmsIrMobile(phone: string) {
  return phone.startsWith("98") && phone.length === 12
    ? phone.substring(2)
    : phone.replace(/^0/, "");
}

// ── ترجمه‌ی کدهای وضعیت sms.ir به راهنمای فارسی ──
const SMSIR_HINTS: Record<string, string> = {
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
  "124": "قالب انتخابی در sms.ir به‌عنوان قالب کد تأیید (OTP) شناسایی نشده است",
};

type SmsResult = {
  ok: boolean;
  provider: "smsir" | "kavenegar" | "none";
  mode?: "verify" | "bulk";
  status?: number | null;
  message?: string;
  hint?: string;
  messageId?: any;
  packId?: any;
  config_missing?: boolean;
  missing_secret?: string;
};

function smsirError(
  mode: "verify" | "bulk",
  data: any,
  fallbackText: string
): SmsResult {
  const status =
    data && typeof data.status === "number" ? Number(data.status) : null;
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

// ── sms.ir / ارسال سریع (Verify) ──
async function sendSmsIrVerify(phone: string, otp: string): Promise<SmsResult> {
  const trySend = async (mobile: string) => {
    const res = await fetch("https://api.sms.ir/v1/send/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/plain",
        "x-api-key": SMSIR_API_KEY,
      },
      body: JSON.stringify({
        mobile,
        templateId: Number(SMSIR_TEMPLATE_ID),
        parameters: [{ name: SMSIR_OTP_PARAMETER, value: otp }],
      }),
    });

    const data = await res.json().catch(() => null);

    if (res.ok && data?.status === 1) {
      return {
        ok: true,
        provider: "smsir" as const,
        mode: "verify" as const,
        status: 1,
        message: String(data?.message ?? "موفق"),
        messageId: data?.data?.messageId ?? null,
      };
    }

    return smsirError("verify", data, `پاسخ نامعتبر از sms.ir (HTTP ${res.status})`);
  };

  let out = await trySend(toSmsIrMobile(phone));

  // اگر فرمت شماره را نپذیرفت، یک‌بار با صفر ابتدایی هم امتحان می‌کنیم
  if (!out.ok && out.status === 104) {
    const alt = await trySend(toLocalMobile(phone));
    if (alt.ok) return alt;
  }

  return out;
}

// ── sms.ir / ارسال گروهی (Bulk) — وقتی قالب (Template) نداریم ──
async function sendSmsIrBulk(phone: string, otp: string): Promise<SmsResult> {
  const message = `کد تأیید شما در آکادمی استاد مهدی عزیزی: ${otp}`;

  const trySend = async (mobile: string) => {
    const res = await fetch("https://api.sms.ir/v1/send/bulk", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/plain",
        "x-api-key": SMSIR_API_KEY,
      },
      body: JSON.stringify({
        lineNumber: Number(SMSIR_LINE_NUMBER),
        messageText: message,
        mobiles: [mobile],
      }),
    });

    const data = await res.json().catch(() => null);

    if (res.ok && data?.status === 1) {
      return {
        ok: true,
        provider: "smsir" as const,
        mode: "bulk" as const,
        status: 1,
        message: String(data?.message ?? "موفق"),
        packId: data?.data?.packId ?? null,
        messageId: data?.data?.messageIds?.[0] ?? null,
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

// ── کاوه‌نگار (پشتیبان) ──
async function sendKavenegar(phone: string, otp: string): Promise<SmsResult> {
  const message = `کد تأیید شما در آکادمی استاد مهدی عزیزی: ${otp}`;

  try {
    const res = await fetch(
      `https://api.kavenegar.com/v1/${KAVENEGAR_API_KEY}/sms/send.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          receptor: toLocalMobile(phone),
          message,
        }).toString(),
      }
    );

    const data = await res.json().catch(() => null);

    // موفقیت کاوه‌نگار: return.status === 200
    if (!res.ok || data?.return?.status !== 200) {
      console.error("kavenegar error", data);
      return {
        ok: false,
        provider: "kavenegar",
        status: Number(data?.return?.status ?? res.status) || null,
        message: String(data?.return?.message ?? ""),
        hint: "اعتبار پنل و تأیید خط ارسال کاوه‌نگار را بررسی کنید",
      };
    }

    return { ok: true, provider: "kavenegar", status: 200, message: "موفق" };
  } catch (e) {
    console.error("kavenegar fetch failed", e);
    return {
      ok: false,
      provider: "kavenegar",
      message: String((e as any)?.message ?? e),
      hint: "ارتباط با سرور کاوه‌نگار برقرار نشد",
    };
  }
}

function activeProvider(): "smsir" | "kavenegar" | "none" {
  if (SMSIR_API_KEY) return "smsir";
  if (KAVENEGAR_API_KEY) return "kavenegar";
  return "none";
}

async function sendSms(phone: string, otp: string): Promise<SmsResult> {
  const provider = activeProvider();

  if (provider === "smsir") {
    // قالب (Verify) مقدم است؛ اگر شناسه‌ی قالب نبود، با خط اختصاصی (Bulk)
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
      message:
        "سکرت SMS_IR_TEMPLATE_ID (شناسه‌ی قالب کد تأیید) تنظیم نشده است",
      hint:
        "در پنل sms.ir یک قالب با متن شامل #CODE# بسازید و شناسه‌اش را در Supabase → Edge Functions → Secrets با نام SMS_IR_TEMPLATE_ID ذخیره کنید (یا به‌جای قالب، سکرت SMS_IR_LINE_NUMBER را تنظیم کنید)",
    };
  }

  if (provider === "kavenegar") {
    return sendKavenegar(phone, otp);
  }

  return { ok: false, provider: "none" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    let phone = body.phone;

    if (!phone) {
      return jsonResponse({ error: "شماره موبایل ارسال نشده" }, 400);
    }

    phone = normalizePhone(phone);

    if (!/^989\d{9}$/.test(phone)) {
      return jsonResponse({ error: "شماره موبایل معتبر نیست" }, 400);
    }

    const { data: lastOtp } = await supabaseAdmin
      .from("otp_codes")
      .select("created_at")
      .eq("phone", phone)
      .eq("purpose", "register")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastOtp) {
      const diff =
        (Date.now() - new Date(lastOtp.created_at).getTime()) / 1000;

      if (diff < OTP_COOLDOWN_SECONDS) {
        // باقی‌مانده را دقیق برمی‌گردانیم تا سایت شمارش معکوس نشان دهد
        const wait = Math.max(1, Math.ceil(OTP_COOLDOWN_SECONDS - diff));

        return jsonResponse(
          {
            error: `تا ${wait} ثانیه‌ی دیگر صبر کنید و دوباره امتحان کنید`,
            retry_after: wait,
            cooldown: true,
          },
          429
        );
      }
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await hashText(otp);

    await supabaseAdmin
      .from("otp_codes")
      .delete()
      .eq("phone", phone)
      .eq("purpose", "register");

    const { error } = await supabaseAdmin
      .from("otp_codes")
      .insert({
        phone,
        code_hash: otpHash,
        purpose: "register",
        expires_at: new Date(
          Date.now() + OTP_EXPIRE_MINUTES * 60 * 1000
        ),
      });

    if (error) {
      console.error(error);
      return jsonResponse({ error: "خطا در ذخیره OTP" }, 500);
    }

    // ── حالت واقعی: ارسال پیامک و عدم افشای کد در پاسخ ──
    if (activeProvider() !== "none") {
      const sent = await sendSms(phone, otp);

      if (!sent.ok) {
        // مهم: ردیف OTP را پاک می‌کنیم تا اگر پنل پیامکی خطا داد، شماره‌ی
        // کاربر به‌خاطر «فاصله‌ی ۶۰ ثانیه‌ای» قفل نماند و بتواند فوراً
        // دوباره تلاش کند.
        await supabaseAdmin
          .from("otp_codes")
          .delete()
          .eq("phone", phone)
          .eq("purpose", "register");

        console.error("sms failed", JSON.stringify(sent));

        return jsonResponse(
          {
            error: `ارسال پیامک ناموفق بود — ${sent.hint ?? sent.message ?? "خطای نامشخص"}`,
            sms_failed: true,
            provider: sent.provider,
            sms_mode: sent.mode ?? null,
            sms_status: sent.status ?? null,
            sms_message: sent.message ?? null,
            sms_config_missing: sent.config_missing === true,
            missing_secret: sent.missing_secret ?? null,
          },
          502
        );
      }

      const payload: any = {
        success: true,
        message: "کد تأیید پیامک شد",
        sent_via_sms: true,
        provider: sent.provider,
        sms_mode: sent.mode ?? null,
        message_id: sent.messageId ?? null,
        expires_in: OTP_EXPIRE_MINUTES * 60,
      };

      // فقط اگر OTP_DEBUG روشن باشد (برای تست با کلید Sandbox)
      if (OTP_DEBUG) {
        payload.debug_code = otp;
        payload.debug = true;
        payload.warning = "OTP_DEBUG روشن است — بعد از تست، این سکرت را حذف کنید";
      }

      return jsonResponse(payload);
    }

    // ── حالت توسعه: فقط برای تست — روی پروداکشن نباید بماند ──
    return jsonResponse({
      success: true,
      message: "OTP ساخته شد (حالت توسعه)",
      debug_code: otp,
      dev_mode: true,
      sms_configured: false,
      provider: "none",
      expires_in: OTP_EXPIRE_MINUTES * 60,
    });
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
