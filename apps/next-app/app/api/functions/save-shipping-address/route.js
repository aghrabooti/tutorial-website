import { createServiceSupabaseClient } from "../../../../lib/supabase-server.js";
import { jsonNoStore, isValidSessionToken } from "../../../../lib/session-token.js";
import { findActiveSessionUser } from "../../../../lib/session-user.js";
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
    const supabase = createServiceSupabaseClient();
    const sessionResult = await findActiveSessionUser(
      supabase,
      token,
      "id,phone,first_name,last_name"
    );
    if (!sessionResult.session || !sessionResult.user) {
      return jsonNoStore({ error: "نشست معتبر نیست" }, 401);
    }

    if (!fullName || !phone || !province || !city || !address || !postalCode) {
      return jsonNoStore({ error: "لطفاً همه‌ی فیلدها را کامل کنید" }, 400);
    }
    if (!/^(?:0?9\d{9}|989\d{9})$/.test(phone)) {
      return jsonNoStore({ error: "شماره تماس معتبر نیست" }, 400);
    }
    if (!/^\d{10}$/.test(postalCode)) {
      return jsonNoStore({ error: "کد پستی باید ۱۰ رقم باشد" }, 400);
    }

    const userId = String(sessionResult.user.id);
    const payload = {
      user_id: userId,
      full_name: fullName,
      phone,
      province,
      city,
      address,
      postal_code: postalCode,
      updated_at: new Date().toISOString(),
    };

    const { data: existing, error: readError } = await supabase
      .from("user_addresses")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (readError) console.error("[api/functions/save-shipping-address] Address lookup failed:", readError);

    const writeResult = existing
      ? await supabase.from("user_addresses").update(payload).eq("user_id", userId)
      : await supabase.from("user_addresses").insert(payload);

    if (writeResult.error) {
      if (writeResult.error.code === "23505") {
        const retry = await supabase
          .from("user_addresses")
          .update(payload)
          .eq("user_id", userId);
        if (!retry.error) return jsonNoStore({ success: true });
      }

      console.error("[api/functions/save-shipping-address] Address save failed:", writeResult.error);
      return jsonNoStore({ error: "خطا در ذخیره آدرس" }, 500);
    }

    return jsonNoStore({ success: true });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/save-shipping-address] Request failed:", error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس نشانی تنظیم نشده است" : error?.message ?? "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
