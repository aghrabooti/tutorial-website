import { createServiceSupabaseClient } from "../../../../lib/supabase-server.js";
import {
  findActiveSession,
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
    const supabase = createServiceSupabaseClient();
    const sessionResult = await findActiveSession(supabase, token);
    if (!sessionResult.session) {
      if (sessionResult.error && !sessionResult.expired) {
        console.error("[api/functions/update-profile] Session lookup failed:", sessionResult.error);
        return jsonNoStore({ success: false, error: "خطا در بررسی نشست" }, 500);
      }
      if (sessionResult.error) {
        console.error("[api/functions/update-profile] Expired session cleanup failed:", sessionResult.error);
      }
      return jsonNoStore(
        {
          success: false,
          error: sessionResult.expired ? "نشست منقضی شده" : "نشست معتبر نیست",
        },
        401
      );
    }

    const { data: user, error } = await supabase
      .from("site_users")
      .update({
        first_name: firstName,
        last_name: lastName,
        grade,
        major: grade === "9" ? "" : major,
      })
      .eq("id", sessionResult.session.user_id)
      .select("id,phone,first_name,last_name,grade,major")
      .single();

    if (error) {
      console.error("[api/functions/update-profile] Profile update failed:", error);
      const message = String(error.message ?? "");
      if (/column|schema cache/i.test(message)) {
        return jsonNoStore(
          {
            success: false,
            error:
              "ستون‌های grade و major در جدول site_users وجود ندارند — دستور SQL آماده در ابزار /profile-doctor را اجرا کنید",
            details: message,
          },
          500
        );
      }
      return jsonNoStore(
        { success: false, error: "خطا در ذخیره اطلاعات", details: message },
        500
      );
    }

    return jsonNoStore({ success: true, user });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/update-profile] Request failed:", error);
    return jsonNoStore(
      {
        success: false,
        error: missingConfig ? "سرویس پروفایل تنظیم نشده است" : error?.message ?? "خطای سرور",
      },
      missingConfig ? 503 : 500
    );
  }
}
