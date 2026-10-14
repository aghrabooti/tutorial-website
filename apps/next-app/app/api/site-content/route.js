import { createServiceSupabaseClient } from "../../../lib/supabase-server.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET() {
  try {
    // This is intentionally a fixed, read-only query. The service-role client
    // is never returned to the browser and accepts no caller-controlled filters.
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase
      .from("site_content")
      .select("key, value, updated_at");

    if (error) {
      console.error("[api/site-content] Supabase read failed:", error);
      const tableMissing = /relation|does not exist|schema cache/i.test(
        String(error.message ?? "")
      );
      return json({
        success: false,
        content: {},
        table_missing: tableMissing,
        error: tableMissing ? "site_content table is not available" : "content unavailable",
      });
    }

    const content = {};
    let updatedAt = "";

    for (const row of data ?? []) {
      if (!row.value) continue;
      content[row.key] = row.value;
      if (row.updated_at > updatedAt) updatedAt = row.updated_at;
    }

    return json({ success: true, content, updated_at: updatedAt });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/site-content] Request failed:", error);
    return json(
      {
        success: false,
        content: {},
        error: missingConfig ? "content service is not configured" : "content unavailable",
      },
      missingConfig ? 503 : 502
    );
  }
}
