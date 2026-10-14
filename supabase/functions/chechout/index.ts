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
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {

    const { token } = await req.json();

    if (!token) {
      return Response.json(
        {
          success: false,
          error: "token missing",
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

    const userId = session.user_id;

    const { data: cartItems, error: cartError } =
      await supabaseAdmin
        .from("cart_items")
        .select(`
          course_id,
          courses(
            price,
            discount_price
          )
        `)
        .eq("user_id", userId);

    if (cartError) {
      return Response.json(
        {
          success: false,
          error: cartError.message,
        },
        {
          status: 500,
          headers: corsHeaders,
        }
      );
    }

    if (!cartItems || cartItems.length === 0) {
      return Response.json(
        {
          success: false,
          error: "cart is empty",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const purchases = cartItems.map((item: any) => ({
      user_id: userId,
      course_id: item.course_id,
      amount:
        item.courses.discount_price ??
        item.courses.price,
      payment_status: "paid",
    }));

    const { error: purchaseError } =
      await supabaseAdmin
        .from("user_purchases")
        .upsert(
          purchases,
          {
            onConflict: "user_id,course_id"
          }
        );

    if (purchaseError) {
      return Response.json(
        {
          success: false,
          error: purchaseError.message,
        },
        {
          status: 500,
          headers: corsHeaders,
        }
      );
    }

    const { error: deleteError } =
      await supabaseAdmin
        .from("cart_items")
        .delete()
        .eq("user_id", userId);

    if (deleteError) {
      return Response.json(
        {
          success: false,
          error: deleteError.message,
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
        message: "purchase completed",
      },
      {
        headers: corsHeaders,
      }
    );

  } catch (error: any) {

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