import { randomUUID } from "node:crypto";
import { query } from "../../../../lib/postgres.js";
import { hashSessionToken, jsonNoStore } from "../../../../lib/session-token.js";
import { verifyPassword } from "../../../../lib/password-hash.js";
import { normalizePhone } from "../../../../lib/phone.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "درخواست نامعتبر است" }, 400);
  }

  const { phone, password } = body ?? {};
  if (typeof phone !== "string" || !phone.trim() || typeof password !== "string" || !password) {
    return jsonNoStore({ error: "اطلاعات ناقص است" }, 400);
  }

  try {
    const normalizedPhone = normalizePhone(phone);
    const { rows } = await query(
      "SELECT * FROM public.site_users WHERE phone = $1 LIMIT 1",
      [normalizedPhone]
    );
    const user = rows[0] ?? null;

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return jsonNoStore({ error: "شماره یا رمز اشتباه است" }, 401);
    }

    if (!user.is_active) {
      return jsonNoStore({ error: "حساب کاربری غیرفعال است" }, 403);
    }

    const token = randomUUID() + randomUUID();
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await query(
      `INSERT INTO public.user_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );

    // Preserve the legacy behavior: last_login failure does not invalidate login.
    try {
      await query(
        "UPDATE public.site_users SET last_login = $2 WHERE id = $1",
        [user.id, new Date()]
      );
    } catch (error) {
      console.error("[api/functions/login-user] last_login update failed:", error?.message ?? error);
    }

    return jsonNoStore({
      success: true,
      token,
      user: {
        id: user.id,
        phone: user.phone,
        first_name: user.first_name,
        last_name: user.last_name,
        grade: user.grade,
        major: user.major,
        role: user.role,
      },
    });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/login-user] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس ورود تنظیم نشده است" : "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
