import { createPublicSupabaseClient } from "../../../lib/supabase-server.js";

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
    const supabase = createPublicSupabaseClient();
    const { data, error } = await supabase.from("courses").select("*");

    if (error) {
      console.error("[api/courses] Supabase read failed:", error);
      return json(
        { data: null, error: { message: "خطا در دریافت محصولات" } },
        502
      );
    }

    return json({ data: data ?? [], error: null });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/courses] Request failed:", error);
    return json(
      { data: null, error: { message: "سرویس محصولات موقتاً در دسترس نیست" } },
      missingConfig ? 503 : 500
    );
  }
}
