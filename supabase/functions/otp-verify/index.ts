import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
};

function jsonResponse(data: any, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    }
  );
}

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
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    const {
      phone,
      code,
      purpose
    } = await req.json();
    
    if (!phone || !code || !purpose) {
      return jsonResponse(
        {
          error: "اطلاعات ناقص است"
        },
        400
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
      return jsonResponse(
        {
          error: "کد پیدا نشد"
        },
        400
      );
    }
    
    const attempts = otp.attempts ?? 0;

    if (attempts >= 5) {
      await supabaseAdmin
        .from("otp_codes")
        .delete()
        .eq("id", otp.id);
      
      return jsonResponse(
        {
          error: "تعداد تلاش زیاد است"
        },
        429
      );
    }
    
    await supabaseAdmin
      .from("otp_codes")
      .update({
        attempts: attempts + 1
      })
      .eq("id", otp.id);
    
    if (new Date(otp.expires_at) < new Date()) {
      return jsonResponse(
        {
          error: "کد منقضی شده است"
        },
        400
      );
    }
    
    if (otp.code_hash !== codeHash) {
      return jsonResponse(
        {
          error: "کد اشتباه است"
        },
        400
      );
    }
    
    await supabaseAdmin
      .from("otp_codes")
      .delete()
      .eq("id", otp.id);
    
    return jsonResponse({
      success: true,
      phone: normalizedPhone,
      purpose,
      message: "کد تایید شد"
    });
  } catch (error) {

    console.error(error);

    const message =
      error instanceof Error
        ? error.message
        : "خطای داخلی سرور";

    return jsonResponse(
      {
        error: message
      },
      500
    );

  }
});