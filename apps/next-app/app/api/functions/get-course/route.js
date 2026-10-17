import { query } from "../../../../lib/postgres.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "invalid request body" }, 400);
  }

  const rawId = body?.course_id;
  if (
    (typeof rawId !== "string" && typeof rawId !== "number") ||
    !String(rawId).trim() ||
    String(rawId).length > 128
  ) {
    return json({ success: false, error: "missing course id" }, 400);
  }

  try {
    const { rows } = await query(
      `SELECT id, title, description, image_url, price, type
       FROM public.courses
       WHERE id = $1
       LIMIT 1`,
      [String(rawId).trim()]
    );
    const course = rows[0] ?? null;
    if (!course) return json({ success: false, error: "course not found" }, 404);
    return json({ success: true, course });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    // Invalid UUID text cannot match a UUID column; preserve the old not-found response.
    if (error?.code === "22P02") {
      return json({ success: false, error: "course not found" }, 404);
    }
    console.error("[api/functions/get-course] PostgreSQL read failed:", error?.message ?? error);
    return json(
      { success: false, error: "course service unavailable" },
      missingConfig ? 503 : 500
    );
  }
}
