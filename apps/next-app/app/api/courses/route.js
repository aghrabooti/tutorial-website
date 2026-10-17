import { query } from "../../../lib/postgres.js";

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
    const { rows } = await query("SELECT * FROM public.courses");
    return json({ data: rows, error: null });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/courses] PostgreSQL read failed:", error?.message ?? error);
    return json(
      {
        data: null,
        error: {
          message: missingConfig
            ? "سرویس محصولات موقتاً در دسترس نیست"
            : "خطا در دریافت محصولات",
        },
      },
      missingConfig ? 503 : 502
    );
  }
}
