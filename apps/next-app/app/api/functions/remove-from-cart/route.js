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
  const cartItemId = body?.cart_item_id;
  if (!isValidSessionToken(token) || !cartItemId) {
    return jsonNoStore({ success: false, error: "token or cart_item_id missing" }, 400);
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

    const { data: deleted, error } = await supabase
      .from("cart_items")
      .delete()
      .eq("id", cartItemId)
      .eq("user_id", sessionResult.user.id)
      .select();

    if (error) {
      console.error("[api/functions/remove-from-cart] Delete failed:", error);
      return jsonNoStore({ success: false, error: error.message }, 500);
    }

    return jsonNoStore({ success: true, message: "removed from cart", deleted });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/remove-from-cart] Request failed:", error);
    return jsonNoStore(
      {
        success: false,
        error: missingConfig ? "Cart service is not configured" : error?.message ?? "Server error",
      },
      missingConfig ? 503 : 500
    );
  }
}
