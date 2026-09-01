// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// send-otp
// ورودی: { phone }
//   اگر سکرت KAVENEGAR_API_KEY تنظیم شده باشد، کد با پیامک (کاوه‌نگار) ارسال
//   می‌شود و دیگر هیچ‌وقت داخل پاسخ API برنمی‌گردد.
//   اگر کلید تنظیم نشده باشد، «حالت توسعه» است و کد در debug_code برمی‌گردد —
//   این حالت فقط برای تست است و نباید روی نسخه‌ی واقعی بماند!
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const KAVENEGAR_API_KEY = Deno.env.get("KAVENEGAR_API_KEY") ?? "";

const OTP_EXPIRE_MINUTES = 2;
const OTP_COOLDOWN_SECONDS = 60;

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

// 989123456789 → 09123456789 (فرمت کاوه‌نگار)
function toLocalMobile(phone: string) {
  return phone.startsWith("98") && phone.length === 12
    ? "0" + phone.substring(2)
    : phone;
}

async function sendSms(phone: string, otp: string) {
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
      return false;
    }

    return true;
  } catch (e) {
    console.error("kavenegar fetch failed", e);
    return false;
  }
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
        return jsonResponse({ error: "لطفاً کمی صبر کنید" }, 429);
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
    if (KAVENEGAR_API_KEY) {
      const sent = await sendSms(phone, otp);

      if (!sent) {
        return jsonResponse(
          { error: "خطا در ارسال پیامک؛ چند دقیقه‌ی دیگر تلاش کنید" },
          502
        );
      }

      return jsonResponse({
        success: true,
        message: "کد تأیید پیامک شد",
        sent_via_sms: true,
      });
    }

    // ── حالت توسعه: فقط برای تست — روی پروداکشن نباید بماند ──
    return jsonResponse({
      success: true,
      message: "OTP ساخته شد (حالت توسعه)",
      debug_code: otp,
      dev_mode: true,
    });
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
