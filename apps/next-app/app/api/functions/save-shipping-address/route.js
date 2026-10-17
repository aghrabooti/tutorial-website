import { query } from "../../../../lib/postgres.js";
import { findActivePostgresSessionUser, isValidSessionToken, jsonNoStore } from "../../../../lib/session-token.js";
import { toLatinDigits } from "../../../../lib/phone.js";

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

  const fullName = String(body?.full_name ?? "").trim();
  const phone = toLatinDigits(String(body?.phone ?? "").trim()).replace(/[\s-]/g, "");
  const province = String(body?.province ?? "").trim();
  const city = String(body?.city ?? "").trim();
  const address = String(body?.address ?? "").trim();
  const postalCode = toLatinDigits(String(body?.postal_code ?? "").trim()).replace(/\s/g, "");

  try {
    const sessionResult = await findActivePostgresSessionUser(token, ["id"]);
    if (sessionResult.error && !sessionResult.expired) throw sessionResult.error;
    if (!sessionResult.session || !sessionResult.user) {
      return jsonNoStore({ error: "نشست معتبر نیست" }, 401);
    }
    if (sessionResult.userError) throw sessionResult.userError;

    if (!fullName || !phone || !province || !city || !address || !postalCode) {
      return jsonNoStore({ error: "لطفاً همه‌ی فیلدها را کامل کنید" }, 400);
    }
    if (!/^(?:0?9\d{9}|989\d{9})$/.test(phone)) {
      return jsonNoStore({ error: "شماره تماس معتبر نیست" }, 400);
    }
    if (!/^\d{10}$/.test(postalCode)) {
      return jsonNoStore({ error: "کد پستی باید ۱۰ رقم باشد" }, 400);
    }

    await query(
      `INSERT INTO public.user_addresses
         (user_id, full_name, phone, province, city, address, postal_code, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         phone = EXCLUDED.phone,
         province = EXCLUDED.province,
         city = EXCLUDED.city,
         address = EXCLUDED.address,
         postal_code = EXCLUDED.postal_code,
         updated_at = NOW()`,
      [String(sessionResult.user.id), fullName, phone, province, city, address, postalCode]
    );

    return jsonNoStore({ success: true });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/save-shipping-address] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس نشانی تنظیم نشده است" : "خطا در ذخیره آدرس" },
      missingConfig ? 503 : 500
    );
  }
}
