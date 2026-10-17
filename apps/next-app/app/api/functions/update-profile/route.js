import { query } from "../../../../lib/postgres.js";
import {
  findActivePostgresSession,
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
    return jsonNoStore({ success: false, error: "درخواست نامعتبر است" }, 400);
  }

  const token = body?.token;
  const firstName = String(body?.first_name ?? "").trim();
  const lastName = String(body?.last_name ?? "").trim();
  const grade = String(body?.grade ?? "").trim();
  const major = String(body?.major ?? "").trim();

  if (!isValidSessionToken(token)) {
    return jsonNoStore({ success: false, error: "توکن ارسال نشده" }, 400);
  }
  if (!firstName || !lastName || !grade) {
    return jsonNoStore({ success: false, error: "اطلاعات ناقص است" }, 400);
  }

  try {
    const sessionResult = await findActivePostgresSession(token);
    if (!sessionResult.session) {
      if (sessionResult.error && !sessionResult.expired) {
        console.error("[api/functions/update-profile] PostgreSQL session lookup failed:", sessionResult.error?.message ?? sessionResult.error);
        return jsonNoStore({ success: false, error: "خطا در بررسی نشست" }, 500);
      }
      if (sessionResult.error) {
        console.error("[api/functions/update-profile] Expired session cleanup failed:", sessionResult.error?.message ?? sessionResult.error);
      }
      return jsonNoStore(
        {
          success: false,
          error: sessionResult.expired ? "نشست منقضی شده" : "نشست معتبر نیست",
        },
        401
      );
    }

    const { rows } = await query(
      `UPDATE public.site_users
       SET first_name = $2, last_name = $3, grade = $4, major = $5
       WHERE id = $1
       RETURNING id, phone, first_name, last_name, grade, major`,
      [sessionResult.session.user_id, firstName, lastName, grade, grade === "9" ? "" : major]
    );
    const user = rows[0] ?? null;
    if (!user) return jsonNoStore({ success: false, error: "کاربر پیدا نشد" }, 404);
    return jsonNoStore({ success: true, user });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/update-profile] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      {
        success: false,
        error: missingConfig ? "سرویس پروفایل تنظیم نشده است" : "خطا در ذخیره اطلاعات",
        ...(error?.code ? { details: String(error.code) } : {}),
      },
      missingConfig ? 503 : 500
    );
  }
}
