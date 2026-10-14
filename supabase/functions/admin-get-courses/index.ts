import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
};

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    const { token } = await req.json();

    if (!token) {
      return jsonResponse(
        {
          error: "توکن ارسال نشده است",
        },
        401
      );
    }

    const tokenHash = await hashText(token);

    const { data: session } = await supabaseAdmin
      .from("user_sessions")
      .select("user_id,expires_at,is_active")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (
      !session ||
      !session.is_active ||
      new Date(session.expires_at) < new Date()
    ) {
      return jsonResponse(
        {
          error: "سشن معتبر نیست",
        },
        401
      );
    }

    const { data: user } = await supabaseAdmin
      .from("site_users")
      .select("role")
      .eq("id", session.user_id)
      .single();

    if (!user || user.role !== "admin") {
      return jsonResponse(
        {
          error: "دسترسی غیرمجاز",
        },
        403
      );
    }

    const { data: courses, error } = await supabaseAdmin
      .from("courses")
      .select(`
        id,
        title,
        grade,
        major,
        category,
        type,
        description,
        price,
        discount_price,
        image_url
      `);

    if (error) {
      console.error(error);

      return jsonResponse(
        {
          error: "خطا در دریافت دوره‌ها",
        },
        500
      );
    }

    return jsonResponse({
      success: true,
      courses,
    });
  } catch (error) {
    console.error(error);

    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "خطای داخلی سرور",
      },
      500
    );
  }
});