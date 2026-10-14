import { createServiceSupabaseClient } from "../../../../lib/supabase-server.js";
import { jsonNoStore, isValidSessionToken } from "../../../../lib/session-token.js";
import { findActiveSessionUser } from "../../../../lib/session-user.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ success: false, error: "invalid request body" }, 400);
  }

  const token = body?.token;
  if (!isValidSessionToken(token)) {
    return jsonNoStore({ success: false, error: "token missing" }, 400);
  }

  try {
    const supabase = createServiceSupabaseClient();
    const sessionResult = await findActiveSessionUser(supabase, token);
    if (!sessionResult.session) {
      return jsonNoStore(
        { success: false, error: sessionResult.expired ? "session expired" : "invalid session" },
        401
      );
    }
    if (!sessionResult.user) {
      return jsonNoStore({ success: false, error: "user not found" }, 404);
    }

    const { data: items, error } = await supabase
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
      .eq("user_id", sessionResult.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return jsonNoStore({ success: false, error: error.message }, 500);
    }

    let totalPrice = 0;
    let totalDiscount = 0;
    for (const item of items ?? []) {
      const course = item.courses;
      const price = Number(course.discount_price ?? course.price ?? 0);
      totalPrice += price;

      if (course.discount_price && course.price) {
        totalDiscount += Number(course.price) - Number(course.discount_price);
      }
    }

    return jsonNoStore({
      success: true,
      items,
      total_price: totalPrice,
      total_discount: totalDiscount,
      count: items?.length ?? 0,
    });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/get-cart] Request failed:", error);
    return jsonNoStore(
      {
        success: false,
        error: missingConfig ? "Cart service is not configured" : error?.message ?? "Server error",
      },
      missingConfig ? 503 : 500
    );
  }
}
