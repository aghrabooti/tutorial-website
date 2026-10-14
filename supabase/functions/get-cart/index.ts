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

    const { data: items, error } = await supabaseAdmin
      .from("cart_items")
      .select(`
        id,
        created_at,
        courses(
          id,
          title,
          description,
          price,
          discount_price,
          image_url,
          grade,
          category,
          type,
          major
        )
      `)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
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

    let totalPrice = 0;
    let totalDiscount = 0;

    for (const item of items ?? []) {

      const course: any = item.courses;

      const price =
        Number(course.discount_price ?? course.price ?? 0);

      totalPrice += price;

      if (
        course.discount_price &&
        course.price
      ) {
        totalDiscount +=
          Number(course.price) -
          Number(course.discount_price);
      }
    }

    return Response.json(
      {
        success: true,
        items,
        total_price: totalPrice,
        total_discount: totalDiscount,
        count: items?.length ?? 0,
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