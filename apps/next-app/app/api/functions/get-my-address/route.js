import { createDatabase } from "../../../../lib/database.js";
import { jsonNoStore, isValidSessionToken } from "../../../../lib/session-token.js";
import { findActiveSessionUser } from "../../../../lib/session-user.js";

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
    const database = createDatabase();
    const sessionResult = await findActiveSessionUser(database, token);
    if (!sessionResult.session || !sessionResult.user) {
      return jsonNoStore({ error: "نشست معتبر نیست" }, 401);
    }

    const { data: address, error } = await database
      .from("user_addresses")
      .select("full_name, phone, province, city, address, postal_code, updated_at")
      .eq("user_id", String(sessionResult.user.id))
      .maybeSingle();

    if (error) {
      console.error("[api/functions/get-my-address] Address lookup failed:", error);
      return jsonNoStore({ error: "خطا در خواندن نشانی" }, 500);
    }

    return jsonNoStore({ success: true, address: address ?? null });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/get-my-address] Request failed:", error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس نشانی تنظیم نشده است" : error?.message ?? "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
