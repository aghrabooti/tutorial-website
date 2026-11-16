import { createHash, randomBytes } from "node:crypto";
import { createDatabase } from "../../../../lib/database.js";
import { normalizePhone } from "../../../../lib/phone.js";
import { jsonNoStore } from "../../../../lib/session-token.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const { phone, code, purpose } = (await request.json().catch(() => null)) ?? {};
  const number = typeof phone === "string" ? normalizePhone(phone) : "";
  if (!/^989\d{9}$/.test(number) || typeof code !== "string" || !/^\d{6}$/.test(code) || purpose !== "register") {
    return jsonNoStore({ error: "اطلاعات نامعتبر است" }, 400);
  }

  const grant = randomBytes(32).toString("hex");
  const { data, error } = await createDatabase().rpc("verify_registration_otp", {
    p_phone: number,
    p_code_hash: createHash("sha256").update(code).digest("hex"),
    p_grant_hash: createHash("sha256").update(grant).digest("hex"),
  });
  if (error) return jsonNoStore({ error: "خطا در تأیید کد" }, 503);
  if (data === "locked") return jsonNoStore({ error: "تعداد تلاش زیاد است" }, 429);
  if (data !== "ok") return jsonNoStore({ error: "کد اشتباه یا منقضی شده است" }, 400);
  return jsonNoStore({ success: true, phone: number, purpose, registration_grant: grant });
}
