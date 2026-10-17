import { findActivePostgresAdmin } from "../../../../lib/admin-auth.js";
import { query, withTransaction } from "../../../../lib/postgres.js";
import {
  isValidContentKey,
  readSiteContent,
  sanitizeContentItems,
} from "../../../../lib/site-content.js";
import { isValidSessionToken, jsonNoStore } from "../../../../lib/session-token.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tableMissing(message) {
  return /relation|does not exist|schema cache/i.test(String(message ?? ""));
}

export async function POST(request) {
  // The legacy function treats malformed JSON as an empty body (a public read).
  let body = {};
  try {
    body = await request.json();
  } catch {
    // Keep the previous default action: get.
  }

  const action = body?.action ?? "get";
  if (action === "get") {
    try {
      return jsonNoStore(await readSiteContent());
    } catch (error) {
      console.error("[api/functions/site-content] PostgreSQL read failed:", error?.message ?? error);
      const missingConfig = String(error?.message ?? "").startsWith(
        "Missing server environment variable:"
      );
      return jsonNoStore({ error: "سرویس محتوا موقتاً در دسترس نیست" }, missingConfig ? 503 : 502);
    }
  }

  const token = body?.token;
  if (!isValidSessionToken(token)) return jsonNoStore({ error: "توکن ارسال نشده" }, 401);

  try {
    const auth = await findActivePostgresAdmin(token);
    if (auth.error && !auth.expired) throw auth.error;
    if (auth.userError) throw auth.userError;
    if (!auth.session || !auth.admin) {
      return jsonNoStore({ error: "دسترسی غیرمجاز — فقط مدیر" }, 403);
    }

    if (action === "set") {
      const items = sanitizeContentItems(body.items);
      const entries = Object.entries(items);
      if (entries.length === 0) return jsonNoStore({ error: "چیزی برای ذخیره ارسال نشد" }, 400);

      const values = [];
      const tuples = entries.map(([key, value], index) => {
        const offset = index * 3;
        values.push(key, value, auth.admin.id);
        return `($${offset + 1}, $${offset + 2}, NOW(), $${offset + 3})`;
      });
      await withTransaction((client) => client.query(
        `INSERT INTO public.site_content (key, value, updated_at, updated_by)
         VALUES ${tuples.join(", ")}
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           updated_at = EXCLUDED.updated_at,
           updated_by = EXCLUDED.updated_by`,
        values
      ));
      return jsonNoStore({ success: true, saved: entries.length });
    }

    if (action === "reset") {
      const keys = (Array.isArray(body?.keys) ? body.keys : [])
        .filter(isValidContentKey)
        .slice(0, 200);
      if (keys.length === 0) return jsonNoStore({ error: "کلیدی ارسال نشد" }, 400);

      await query("DELETE FROM public.site_content WHERE key = ANY($1::text[])", [keys]);
      return jsonNoStore({ success: true, removed: keys.length });
    }

    return jsonNoStore({ error: "اکشن نامعتبر است" }, 400);
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/site-content] PostgreSQL request failed:", error?.message ?? error);
    if (tableMissing(error?.message)) {
      return jsonNoStore({
        error: "جدول site_content در PostgreSQL ساخته نشده — migration 0001_initial_schema.sql را اجرا کنید",
        table_missing: true,
      }, 500);
    }
    return jsonNoStore(
      { error: missingConfig ? "سرویس محتوا تنظیم نشده است" : "خطا در ذخیره‌سازی" },
      missingConfig ? 503 : 500
    );
  }
}
