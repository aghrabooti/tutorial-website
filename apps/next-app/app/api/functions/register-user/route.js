import { createHash } from "node:crypto";
import { createDatabase } from "../../../../lib/database.js";
import { hashPassword } from "../../../../lib/password-hash.js";
import { jsonNoStore } from "../../../../lib/session-token.js";
import { normalizePhone } from "../../../../lib/phone.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const { phone, password, first_name, last_name, registration_grant: grant } =
    (await request.json().catch(() => null)) ?? {};
  const number = typeof phone === "string" ? normalizePhone(phone) : "";
  if (!/^989\d{9}$/.test(number) || typeof password !== "string" || password.length < 6 || password.length > 1024) {
    return jsonNoStore({ error: "شماره یا رمز نامعتبر است" }, 400);
  }
  if (typeof grant !== "string" || !/^[a-f0-9]{64}$/.test(grant)) {
    return jsonNoStore({ error: "شماره را با کد پیامکی تأیید کنید" }, 403);
  }

  try {
    const { data, error } = await createDatabase().rpc("register_verified_user", {
      p_phone: number,
      p_grant_hash: createHash("sha256").update(grant).digest("hex"),
      p_password_hash: await hashPassword(password),
      p_first_name: String(first_name ?? "").trim(),
      p_last_name: String(last_name ?? "").trim(),
    });
    if (error?.code === "23505") return jsonNoStore({ error: "این شماره قبلاً ثبت شده است" }, 409);
    if (error) return jsonNoStore({ error: "خطا در ساخت کاربر" }, 500);
    if (!data?.length) return jsonNoStore({ error: "تأیید شماره معتبر نیست" }, 403);
    return jsonNoStore({ success: true, user: data[0] });
  } catch (error) {
    console.error("[register-user]", error);
    return jsonNoStore({ error: "خطا در ساخت کاربر" }, 503);
  }
}
