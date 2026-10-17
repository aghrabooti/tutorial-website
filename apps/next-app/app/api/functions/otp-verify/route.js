import { createHash, timingSafeEqual } from "node:crypto";
import { jsonNoStore } from "../../../../lib/session-token.js";
import { normalizePhone } from "../../../../lib/phone.js";
import { withTransaction } from "../../../../lib/postgres.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OTP_PURPOSES = new Set(["register", "reset_password", "change_phone"]);

function hashText(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function hashesEqual(left, right) {
  if (!/^[0-9a-f]{64}$/i.test(String(left)) || !/^[0-9a-f]{64}$/i.test(String(right))) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "اطلاعات ناقص است" }, 400);
  }

  const { phone, code, purpose } = body ?? {};
  if (!phone || code === undefined || code === null || !purpose) {
    return jsonNoStore({ error: "اطلاعات ناقص است" }, 400);
  }
  if (!OTP_PURPOSES.has(purpose)) {
    return jsonNoStore({ error: "نوع درخواست نامعتبر است" }, 400);
  }

  const normalizedPhone = normalizePhone(phone);
  const codeHash = hashText(code);

  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, code_hash, attempts,
                expires_at < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AS expired
         FROM public.otp_codes
         WHERE phone = $1 AND purpose = $2
         ORDER BY created_at DESC LIMIT 1
         FOR UPDATE`,
        [normalizedPhone, purpose]
      );
      const otp = rows[0] ?? null;
      if (!otp) return { status: 400, body: { error: "کد پیدا نشد" } };

      const attempts = Number(otp.attempts ?? 0);
      if (attempts >= 5) {
        await client.query("DELETE FROM public.otp_codes WHERE id = $1", [otp.id]);
        return { status: 429, body: { error: "تعداد تلاش زیاد است" } };
      }

      await client.query(
        "UPDATE public.otp_codes SET attempts = COALESCE(attempts, 0) + 1 WHERE id = $1",
        [otp.id]
      );

      if (otp.expired) return { status: 400, body: { error: "کد منقضی شده است" } };
      if (!hashesEqual(otp.code_hash, codeHash)) {
        return { status: 400, body: { error: "کد اشتباه است" } };
      }

      await client.query("DELETE FROM public.otp_codes WHERE id = $1", [otp.id]);
      return {
        status: 200,
        body: {
          success: true,
          phone: normalizedPhone,
          purpose,
          message: "کد تایید شد",
        },
      };
    });

    return jsonNoStore(result.body, result.status);
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/otp-verify] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس تأیید کد تنظیم نشده است" : "خطای داخلی سرور" },
      missingConfig ? 503 : 500
    );
  }
}
