import { query } from "../../../../lib/postgres.js";
import { findActivePostgresSessionUser, isValidSessionToken, jsonNoStore } from "../../../../lib/session-token.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "درخواست نامعتبر است" }, 400);
  }

  const token = body?.token;
  if (!isValidSessionToken(token)) {
    return jsonNoStore({ error: "توکن ارسال نشده" }, 401);
  }

  try {
    const sessionResult = await findActivePostgresSessionUser(token);
    if (sessionResult.error && !sessionResult.expired) throw sessionResult.error;
    if (!sessionResult.session || !sessionResult.user) {
      return jsonNoStore({ error: "نشست معتبر نیست" }, 401);
    }
    if (sessionResult.userError) throw sessionResult.userError;

    const { rows } = await query(
      `SELECT full_name, phone, province, city, address, postal_code, updated_at
       FROM public.user_addresses
       WHERE user_id = $1
       LIMIT 1`,
      [String(sessionResult.user.id)]
    );

    return jsonNoStore({ success: true, address: rows[0] ?? null });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/get-my-address] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس نشانی تنظیم نشده است" : "خطا در خواندن نشانی" },
      missingConfig ? 503 : 500
    );
  }
}
