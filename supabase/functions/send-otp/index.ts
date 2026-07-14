import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const OTP_EXPIRE_MINUTES = 2;
const OTP_COOLDOWN_SECONDS = 60;

async function hashText(text: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizePhone(phone: string) {
  phone = phone.trim();
  phone = phone.replace(/\s+/g, "");
  
  if (phone.startsWith("09")) {
    phone = "98" + phone.substring(1);
  }
  
  if (phone.startsWith("+98")) {
    phone = phone.substring(1);
  }
  
  return phone;
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    let phone = body.phone;
    
    if (!phone) {
      return new Response(
        JSON.stringify({
          error: "شماره موبایل ارسال نشده"
        }),
        {
          status: 400
        }
      );
    }
    
    phone = normalizePhone(phone);
    
    if (!/^989\d{9}$/.test(phone)) {
      return new Response(
        JSON.stringify({
          error: "شماره موبایل معتبر نیست"
        }),
        {
          status: 400
        }
      );
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
      const diff = (Date.now() - new Date(lastOtp.created_at).getTime()) / 1000;
      
      if (diff < OTP_COOLDOWN_SECONDS) {
        return new Response(
          JSON.stringify({
            error: "لطفاً کمی صبر کنید"
          }),
          {
            status: 429
          }
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
        expires_at: new Date(Date.now() + OTP_EXPIRE_MINUTES * 60 * 1000)
      });
    
    if (error) {
      console.error(error);
      return new Response(
        JSON.stringify({
          error: "خطا در ذخیره OTP"
        }),
        {
          status: 500
        }
      );
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        message: "OTP ساخته شد",
        debug_code: otp
      }),
      {
        status: 200
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error.message
      }),
      {
        status: 500
      }
    );
  }
});