import { query } from "../../../../lib/postgres.js";
import { findActivePostgresSessionUser, isValidSessionToken, jsonNoStore } from "../../../../lib/session-token.js";

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
    const sessionResult = await findActivePostgresSessionUser(token);
    if (sessionResult.error && !sessionResult.expired) throw sessionResult.error;
    if (!sessionResult.session) {
      return jsonNoStore(
        { success: false, error: sessionResult.expired ? "session expired" : "invalid session" },
        401
      );
    }
    if (sessionResult.userError) throw sessionResult.userError;
    if (!sessionResult.user) return jsonNoStore({ success: false, error: "user not found" }, 404);

    const { rows: deleted } = await query(
      `DELETE FROM public.cart_items
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [cartItemId, sessionResult.user.id]
    );

    return jsonNoStore({ success: true, message: "removed from cart", deleted });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/remove-from-cart] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      {
        success: false,
        error: missingConfig ? "Cart service is not configured" : error?.message ?? "Server error",
      },
      missingConfig ? 503 : 500
    );
  }
}
