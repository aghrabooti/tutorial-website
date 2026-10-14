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
  const courseId = body?.course_id;
  if (!isValidSessionToken(token) || !courseId) {
    return jsonNoStore({ success: false, error: "missing data" }, 400);
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

    const { data: course } = await supabase
      .from("courses")
      .select("id")
      .eq("id", courseId)
      .maybeSingle();

    if (!course) {
      return jsonNoStore({ success: false, error: "course not found" }, 404);
    }

    const { data: purchased } = await supabase
      .from("user_purchases")
      .select("id")
      .eq("user_id", sessionResult.user.id)
      .eq("course_id", courseId)
      .maybeSingle();

    if (purchased) {
      return jsonNoStore({ success: false, error: "already purchased" }, 409);
    }

    const { data: exists } = await supabase
      .from("cart_items")
      .select("id")
      .eq("user_id", sessionResult.user.id)
      .eq("course_id", courseId)
      .maybeSingle();

    if (exists) {
      return jsonNoStore({ success: true, message: "already in cart" });
    }

    const { error: insertError } = await supabase.from("cart_items").insert({
      user_id: sessionResult.user.id,
      course_id: courseId,
    });

    if (insertError) {
      return jsonNoStore({ success: false, error: insertError.message }, 500);
    }

    return jsonNoStore({ success: true, message: "added to cart" });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/add-to-cart] Request failed:", error);
    return jsonNoStore(
      {
        success: false,
        error: missingConfig ? "Cart service is not configured" : error?.message ?? "Server error",
      },
      missingConfig ? 503 : 500
    );
  }
}
