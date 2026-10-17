import { query } from "../../../../lib/postgres.js";
import { hashPassword } from "../../../../lib/password-hash.js";
import { jsonNoStore } from "../../../../lib/session-token.js";
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

  const { phone, password, first_name, last_name } = body ?? {};
  if (typeof phone !== "string" || !phone.trim() || typeof password !== "string" || !password) {
    return jsonNoStore({ error: "اطلاعات ناقص است" }, 400);
  }
  if (password.length < 6) {
    return jsonNoStore({ error: "رمز باید حداقل ۶ کاراکتر باشد" }, 400);
  }

  try {
    const normalizedPhone = normalizePhone(phone);
    const existing = await query(
      "SELECT id FROM public.site_users WHERE phone = $1 LIMIT 1",
      [normalizedPhone]
    );
    if (existing.rows.length > 0) {
      return jsonNoStore({ error: "این شماره قبلاً ثبت شده است" }, 409);
    }

    const passwordHash = await hashPassword(password);
    const created = await query(
      `INSERT INTO public.site_users
         (phone, password_hash, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, 'student')
       RETURNING id, phone, concat_ws(' ', first_name, last_name) AS full_name`,
      [
        normalizedPhone,
        passwordHash,
        String(first_name ?? "").trim(),
        String(last_name ?? "").trim(),
      ]
    );
    const user = created.rows[0];

    return jsonNoStore({
      success: true,
      user: {
        id: user.id,
        phone: user.phone,
        full_name: user.full_name,
      },
    });
  } catch (error) {
    if (error?.code === "23505") {
      return jsonNoStore({ error: "این شماره قبلاً ثبت شده است" }, 409);
    }
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/register-user] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس ثبت‌نام تنظیم نشده است" : "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
