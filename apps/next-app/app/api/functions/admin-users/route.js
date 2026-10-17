import { query } from "../../../../lib/postgres.js";
import { findActivePostgresAdmin } from "../../../../lib/admin-auth.js";
import { jsonNoStore, isValidSessionToken } from "../../../../lib/session-token.js";

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
  if (!isValidSessionToken(token)) return jsonNoStore({ error: "توکن ارسال نشده" }, 401);

  try {
    const auth = await findActivePostgresAdmin(token);
    if (auth.error && !auth.expired) throw auth.error;
    if (auth.userError) throw auth.userError;
    if (!auth.admin) return jsonNoStore({ error: "دسترسی غیرمجاز — فقط مدیر" }, 403);

    const { rows: users } = await query(
      `SELECT id, phone, first_name, last_name, role
       FROM public.site_users
       LIMIT 300`
    );
    return jsonNoStore({ success: true, users });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith("Missing server environment variable:");
    console.error("[api/functions/admin-users] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس کاربران تنظیم نشده است" : "خطا در خواندن کاربران" },
      missingConfig ? 503 : 500
    );
  }
}
