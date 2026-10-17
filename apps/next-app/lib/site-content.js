import "server-only";
import { query } from "./postgres.js";

export const MAX_CONTENT_VALUE_LENGTH = 8000;
export const MAX_CONTENT_KEYS_PER_CALL = 200;

export function isValidContentKey(key) {
  return typeof key === "string" && /^[a-z0-9][a-z0-9._-]{1,79}$/i.test(key);
}

export function sanitizeContentItems(raw) {
  const clean = {};
  if (!raw || typeof raw !== "object") return clean;

  for (const [key, value] of Object.entries(raw)) {
    if (!isValidContentKey(key)) continue;
    clean[key] = (value === null || value === undefined ? "" : String(value))
      .slice(0, MAX_CONTENT_VALUE_LENGTH);
    if (Object.keys(clean).length >= MAX_CONTENT_KEYS_PER_CALL) break;
  }

  return clean;
}

export async function readSiteContent() {
  try {
    const { rows } = await query(
      "SELECT key, value, updated_at FROM public.site_content ORDER BY key"
    );
    const content = {};
    let updatedAt = "";
    for (const row of rows) {
      if (!row.value) continue;
      content[row.key] = row.value;
      const timestamp = row.updated_at ? new Date(row.updated_at).toISOString() : "";
      if (timestamp > updatedAt) updatedAt = timestamp;
    }
    return { success: true, content, updated_at: updatedAt };
  } catch (error) {
    if (String(error?.message ?? "").startsWith("Missing server environment variable:")) throw error;
    console.error("[api/site-content] PostgreSQL read failed:", error?.message ?? error);
    const tableMissing = /relation|does not exist|schema cache/i.test(String(error?.message ?? ""));
    return {
      success: false,
      content: {},
      table_missing: tableMissing,
      error: tableMissing
        ? "جدول site_content در PostgreSQL ساخته نشده — migration 0001_initial_schema.sql را اجرا کنید"
        : "خطا در خواندن محتوا",
    };
  }
}
