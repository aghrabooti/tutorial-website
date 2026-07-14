import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

async function hashText(text: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizePhone(phone: string) {
  phone = phone.trim().replace(/\s+/g, "");
  
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
    const {
      phone,
      code,
      purpose
    } = await req.json();
    
    if (!phone || !code || !purpose) {
      return new Response(
        JSON.stringify({
          error: "اطلاعات ناقص است"
        }),
        {
          status: 400
        }
      );
    }
    
    const normalizedPhone = normalizePhone(phone);
    const codeHash = await hashText(code);
    
    const { data: otp, error } = await supabaseAdmin
      .from("otp_codes")
      .select("*")
      .eq("phone", normalizedPhone)
      .eq("purpose", purpose)
      .single();
    
    if (error || !otp) {
      return new Response(
        JSON.stringify({
          error: "کد پیدا نشد"
        }),
        {
          status: 400
        }
      );
    }
    
    if (otp.attempts >= 5) {
      await supabaseAdmin
        .from("otp_codes")
        .delete()
        .eq("id", otp.id);
      
      return new Response(
        JSON.stringify({
          error: "تعداد تلاش زیاد است"
        }),
        {
          status: 429
        }
      );
    }
    
    await supabaseAdmin
      .from("otp_codes")
      .update({
        attempts: otp.attempts + 1
      })
      .eq("id", otp.id);
    
    if (new Date(otp.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({
          error: "کد منقضی شده است"
        }),
        {
          status: 400
        }
      );
    }
    
    if (otp.code_hash !== codeHash) {
      return new Response(
        JSON.stringify({
          error: "کد اشتباه است"
        }),
        {
          status: 400
        }
      );
    }
    
    await supabaseAdmin
      .from("otp_codes")
      .delete()
      .eq("id", otp.id);
    
    return new Response(
      JSON.stringify({
        success: true,
        phone: normalizedPhone,
        purpose,
        message: "کد تایید شد"
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