import { query } from "../../../../lib/postgres.js";
import {
  hashSessionToken,
  isValidSessionToken,
  jsonNoStore,
} from "../../../../lib/session-token.js";

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
    return jsonNoStore({ error: "توکن ارسال نشده" }, 400);
  }

  try {
    const tokenHash = hashSessionToken(token);
    const { rows } = await query(
      `SELECT id FROM public.user_sessions
       WHERE token_hash = $1 AND is_active IS TRUE
       LIMIT 1`,
      [tokenHash]
    );
    const session = rows[0] ?? null;
    if (!session) return jsonNoStore({ error: "Session پیدا نشد" }, 401);

    await query(
      "UPDATE public.user_sessions SET is_active = false WHERE id = $1",
      [session.id]
    );
    return jsonNoStore({ success: true, message: "با موفقیت خارج شدید" });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/logout-user] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس نشست تنظیم نشده است" : "خطا در خروج" },
      missingConfig ? 503 : 500
    );
  }
}
