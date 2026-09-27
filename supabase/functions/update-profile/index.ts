// ─────────────────────────────────────────────────────────────────────────────
// update-profile
// ورودی: { token, first_name, last_name, grade, major }
//   کاربر بعد از ثبت‌نام (شماره + رمز) این‌جا نام، نام خانوادگی، پایه و رشته را
//   پر می‌کند. توکن نشست (session_token) از مرورگر می‌آید.
// خروجی: { success:true } یا { success:false, error:"..." }
//
// نکته‌ی مهم: این فایل قبلاً خالی بود (هیچ کدی نداشت) → سرور ۵۰۲ می‌داد.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// توکن نشست به‌صورت هش ذخیره می‌شود (مثل check-session)
async function hashText(text: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {

  // درخواست preflight مرورگر
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    const token = body.token;
    const firstName = String(body.first_name ?? "").trim();
    const lastName = String(body.last_name ?? "").trim();
    const grade = String(body.grade ?? "").trim();
    const major = String(body.major ?? "").trim();

    if (!token) {
      return jsonResponse({ success: false, error: "توکن ارسال نشده" }, 400);
    }

    if (!firstName || !lastName || !grade) {
      return jsonResponse({ success: false, error: "اطلاعات ناقص است" }, 400);
    }

    // ── پیدا کردن نشست فعال با همین توکن ──
    const tokenHash = await hashText(token);

    const { data: session } = await supabaseAdmin
      .from("user_sessions")
      .select("id,user_id,expires_at,is_active")
      .eq("token_hash", tokenHash)
      .eq("is_active", true)
      .maybeSingle();

    if (!session) {
      return jsonResponse({ success: false, error: "نشست معتبر نیست" }, 401);
    }

    if (new Date(session.expires_at) < new Date()) {
      await supabaseAdmin
        .from("user_sessions")
        .update({ is_active: false })
        .eq("id", session.id);

      return jsonResponse({ success: false, error: "نشست منقضی شده" }, 401);
    }

    // ── ذخیره‌ی اطلاعات ──
    // پایه‌ی نهم رشته ندارد → رشته خالی ذخیره می‌شود
    const { data: user, error } = await supabaseAdmin
      .from("site_users")
      .update({
        first_name: firstName,
        last_name: lastName,
        grade: grade,
        major: grade === "9" ? "" : major,
      })
      .eq("id", session.user_id)
      .select("id,phone,first_name,last_name,grade,major")
      .single();

    if (error) {
      console.error(error);

      // اگر ستون‌های grade/major در دیتابیس نباشند، پیام واضح می‌دهیم
      const message = String(error.message ?? "");
      if (/column|schema cache/i.test(message)) {
        return jsonResponse(
          {
            success: false,
            error:
              "ستون‌های grade و major در جدول site_users وجود ندارند — دستور SQL آماده در ابزار /profile-doctor را اجرا کنید",
            details: message,
          },
          500
        );
      }

      return jsonResponse(
        { success: false, error: "خطا در ذخیره اطلاعات", details: message },
        500
      );
    }

    return jsonResponse({ success: true, user });

  } catch (error: any) {
    console.error(error);
    return jsonResponse(
      { success: false, error: error?.message ?? "خطای سرور" },
      500
    );
  }
});
