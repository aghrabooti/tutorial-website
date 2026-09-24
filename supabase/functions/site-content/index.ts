// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// site-content — خواندن و ذخیره‌ی متن‌ها/عکس‌های قابل ویرایش سایت
//
// اکشن‌ها (همه با POST و بدنه‌ی JSON):
//   { action: "get" }                        → عمومی — همه‌ی مقادیر ذخیره‌شده
//   { action: "set", token, items: {…} }     → فقط مدیر — ذخیره/به‌روزرسانی
//   { action: "reset", token, keys: [ … ] }  → فقط مدیر — حذف مقدار (بازگشت به
//                                              متن پیش‌فرض خودِ HTML)
//
// نکته‌ی مهم: اگر کلیدی در دیتابیس نباشد، سایت مقدار پیش‌فرض HTML را نشان
// می‌دهد. پس «reset» یعنی «همان چیزی که برنامه‌نویس نوشته بود».
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_VALUE_LENGTH = 8000;   // سقف طول متن (کاراکتر)
const MAX_KEYS_PER_CALL = 200;   // سقف تعداد کلید در هر درخواست

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function hashText(text: string) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getAdminUser(token: string) {
  const tokenHash = await hashText(token);

  const { data: session } = await supabaseAdmin
    .from("user_sessions")
    .select("*")
    .eq("token_hash", tokenHash)
    .eq("is_active", true)
    .maybeSingle();

  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) return null;

  const { data: user } = await supabaseAdmin
    .from("site_users")
    .select("id, role")
    .eq("id", session.user_id)
    .maybeSingle();

  if (!user || user.role !== "admin") return null;
  return user;
}

// کلیدها انگلیسی و محدود هستند تا با data-content در HTML یکی باشند
function isValidKey(key: string) {
  return typeof key === "string" && /^[a-z0-9][a-z0-9._-]{1,79}$/i.test(key);
}

function sanitizeItems(raw: any) {
  const clean: Record<string, string> = {};

  if (!raw || typeof raw !== "object") return clean;

  for (const [key, value] of Object.entries(raw)) {
    if (!isValidKey(key)) continue;

    const text = value === null || value === undefined ? "" : String(value);
    clean[key] = text.slice(0, MAX_VALUE_LENGTH);

    if (Object.keys(clean).length >= MAX_KEYS_PER_CALL) break;
  }

  return clean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "get";

    // ── خواندن عمومی (سایت با این اکشن مقدارها را می‌گیرد) ──
    if (action === "get") {
      const { data, error } = await supabaseAdmin
        .from("site_content")
        .select("key, value, updated_at");

      if (error) {
        console.error(error);
        // به‌جای خطا، شیء خالی برمی‌گردانیم تا سایت با متن پیش‌فرض کار کند
        return jsonResponse({ success: false, content: {}, error: "خطا در خواندن محتوا" });
      }

      const content: Record<string, string> = {};
      let latest = "";

      for (const row of data ?? []) {
        if (!row.value) continue;
        content[row.key] = row.value;
        if (row.updated_at > latest) latest = row.updated_at;
      }

      return jsonResponse({ success: true, content, updated_at: latest });
    }

    // ── از این‌جا به بعد فقط مدیر ──
    if (!body.token) return jsonResponse({ error: "توکن ارسال نشده" }, 401);

    const admin = await getAdminUser(body.token);
    if (!admin) return jsonResponse({ error: "دسترسی غیرمجاز — فقط مدیر" }, 403);

    if (action === "set") {
      const items = sanitizeItems(body.items);

      if (!Object.keys(items).length) {
        return jsonResponse({ error: "چیزی برای ذخیره ارسال نشد" }, 400);
      }

      const rows = Object.entries(items).map(([key, value]) => ({
        key,
        value,
        updated_at: new Date().toISOString(),
        updated_by: admin.id,
      }));

      const { error } = await supabaseAdmin
        .from("site_content")
        .upsert(rows, { onConflict: "key" });

      if (error) {
        console.error(error);
        return jsonResponse({ error: "خطا در ذخیره‌سازی" }, 500);
      }

      return jsonResponse({ success: true, saved: rows.length });
    }

    if (action === "reset") {
      const keys = (Array.isArray(body.keys) ? body.keys : [])
        .filter((k: any) => isValidKey(k))
        .slice(0, MAX_KEYS_PER_CALL);

      if (!keys.length) return jsonResponse({ error: "کلیدی ارسال نشد" }, 400);

      const { error } = await supabaseAdmin
        .from("site_content")
        .delete()
        .in("key", keys);

      if (error) {
        console.error(error);
        return jsonResponse({ error: "خطا در بازگردانی" }, 500);
      }

      return jsonResponse({ success: true, removed: keys.length });
    }

    return jsonResponse({ error: "اکشن نامعتبر است" }, 400);
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای داخلی" }, 500);
  }
});
