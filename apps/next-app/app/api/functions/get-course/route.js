import { createPublicSupabaseClient } from "../../../../lib/supabase-server.js";

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
    const supabase = createPublicSupabaseClient();
    const { data: course, error } = await supabase
      .from("courses")
      .select("id, title, description, image_url, price, type")
      .eq("id", String(rawId).trim())
      .single();

    if (error || !course) {
      if (error) console.error("[api/functions/get-course] Read failed:", error);
      return json({ success: false, error: "course not found" }, 404);
    }

    return json({ success: true, course });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/get-course] Request failed:", error);
    return json(
      { success: false, error: "course service unavailable" },
      missingConfig ? 503 : 500
    );
  }
}
