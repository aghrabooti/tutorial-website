import { query } from "../../../../lib/postgres.js";
import { hashPassword, verifyPassword } from "../../../../lib/password-hash.js";
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
    return jsonNoStore({ error: "درخواست نامعتبر است" }, 400);
  }

  const { token, current_password: currentPassword, new_password: newPassword } = body ?? {};
  if (!isValidSessionToken(token)) {
    return jsonNoStore({ error: "توکن ارسال نشده" }, 401);
  }
  if (typeof currentPassword !== "string" || !currentPassword || typeof newPassword !== "string" || !newPassword) {
    return jsonNoStore({ error: "رمز فعلی و جدید هر دو لازم است" }, 400);
  }
  if (newPassword.length < 8) {
    return jsonNoStore({ error: "رمز جدید باید حداقل ۸ کاراکتر باشد" }, 400);
  }

  try {
    const sessionResult = await findActivePostgresSession(token);
    if (!sessionResult.session) {
      if (sessionResult.error && !sessionResult.expired) {
        console.error("[api/functions/change-password] PostgreSQL session lookup failed:", sessionResult.error?.message ?? sessionResult.error);
        return jsonNoStore({ error: "خطا در بررسی نشست" }, 500);
      }
      if (sessionResult.error) {
        console.error("[api/functions/change-password] Expired session cleanup failed:", sessionResult.error?.message ?? sessionResult.error);
      }
      return jsonNoStore(
        { error: sessionResult.expired ? "نشست منقضی شده است" : "نشست معتبر نیست" },
        401
      );
    }

    const { rows } = await query(
      "SELECT id, password_hash FROM public.site_users WHERE id = $1 LIMIT 1",
      [sessionResult.session.user_id]
    );
    const user = rows[0] ?? null;
    if (!user) return jsonNoStore({ error: "کاربر پیدا نشد" }, 404);
    if (!(await verifyPassword(currentPassword, user.password_hash))) {
      return jsonNoStore({ error: "رمز عبور فعلی اشتباه است" }, 403);
    }

    const newHash = await hashPassword(newPassword);
    await query(
      "UPDATE public.site_users SET password_hash = $2 WHERE id = $1",
      [user.id, newHash]
    );

    // Preserve old behavior: revoking other sessions is best-effort after password save.
    try {
      await query(
        `UPDATE public.user_sessions SET is_active = false
         WHERE user_id = $1 AND id <> $2`,
        [user.id, sessionResult.session.id]
      );
    } catch (error) {
      console.error("[api/functions/change-password] Other session revocation failed:", error?.message ?? error);
    }

    return jsonNoStore({ success: true });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/change-password] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس تغییر رمز تنظیم نشده است" : "خطا در ذخیره‌ی رمز جدید" },
      missingConfig ? 503 : 500
    );
  }
}
