import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function hashText(text: string) {
  const data = new TextEncoder().encode(text);

  const hash = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    const { token, course_id } = await req.json();

    if (!token || !course_id) {
      return Response.json(
        {
          success: false,
          error: "missing data",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const tokenHash = await hashText(token);

    const { data: session } = await supabaseAdmin
      .from("user_sessions")
      .select("*")
      .eq("token_hash", tokenHash)
      .eq("is_active", true)
      .maybeSingle();

    if (!session) {
      return Response.json(
        {
          success: false,
          error: "invalid session",
        },
        {
          status: 401,
          headers: corsHeaders,
        }
      );
    }

    if (new Date(session.expires_at) < new Date()) {
      await supabaseAdmin
        .from("user_sessions")
        .update({
          is_active: false,
        })
        .eq("id", session.id);

      return Response.json(
        {
          success: false,
          error: "session expired",
        },
        {
          status: 401,
          headers: corsHeaders,
        }
      );
    }

    const { data: user } = await supabaseAdmin
      .from("site_users")
      .select("id")
      .eq("id", session.user_id)
      .single();

    if (!user) {
      return Response.json(
        {
          success: false,
          error: "user not found",
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    const { data: course } = await supabaseAdmin
      .from("courses")
      .select("id")
      .eq("id", course_id)
      .single();

    if (!course) {
      return Response.json(
        {
          success: false,
          error: "course not found",
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    const { data: purchased } = await supabaseAdmin
      .from("user_purchases")
      .select("id")
      .eq("user_id", user.id)
      .eq("course_id", course_id)
      .maybeSingle();

    if (purchased) {
      return Response.json(
        {
          success: false,
          error: "already purchased",
        },
        {
          status: 409,
          headers: corsHeaders,
        }
      );
    }

    const { data: exists } = await supabaseAdmin
      .from("cart_items")
      .select("id")
      .eq("user_id", user.id)
      .eq("course_id", course_id)
      .maybeSingle();

    if (exists) {
      return Response.json(
        {
          success: true,
          message: "already in cart",
        },
        {
          headers: corsHeaders,
        }
      );
    }

    const { error: insertError } = await supabaseAdmin
      .from("cart_items")
      .insert({
        user_id: user.id,
        course_id,
      });

    if (insertError) {
      return Response.json(
        {
          success: false,
          error: insertError.message,
        },
        {
          status: 500,
          headers: corsHeaders,
        }
      );
    }

    return Response.json(
      {
        success: true,
        message: "added to cart",
      },
      {
        headers: corsHeaders,
      }
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error.message,
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
});