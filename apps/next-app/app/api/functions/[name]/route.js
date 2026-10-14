import { requiredEnv } from "../../../../lib/supabase-server.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Temporary compatibility bridge for browser-used functions that have not yet
// been ported. Keep this list explicit: never let a caller choose an arbitrary
// Supabase Edge Function (especially hooks or test-only functions).
const EDGE_FUNCTIONS = new Set([
  "get-course-file",
  "get-course-sessions",
  "otp-verify",
  "payment-request",
  "payment-verify",
  "send-otp",
  "site-content",
]);

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request, context) {
  const { name } = await context.params;
  if (!EDGE_FUNCTIONS.has(name)) {
    return json({ error: "function not found" }, 404);
  }

  const contentType = (request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return json({ error: "application/json is required" }, 415);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 1024 * 1024) {
    return json({ error: "request body is too large" }, 413);
  }

  let body;
  let serializedBody;
  try {
    body = await request.json();
    serializedBody = JSON.stringify(body);
  } catch {
    return json({ error: "invalid request body" }, 400);
  }

  if (new TextEncoder().encode(serializedBody).byteLength > 1024 * 1024) {
    return json({ error: "request body is too large" }, 413);
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/+$/, "");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const upstream = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: serializedBody,
      cache: "no-store",
      redirect: "manual",
    });

    const responseBody = await upstream.text();
    const headers = new Headers({ "Cache-Control": "no-store" });
    const upstreamContentType = upstream.headers.get("content-type");
    if (upstreamContentType) headers.set("Content-Type", upstreamContentType);

    return new Response(responseBody || null, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error(`[api/functions/${name}] Compatibility request failed:`, error);
    return json(
      { error: missingConfig ? "API compatibility service is not configured" : "API backend unavailable" },
      missingConfig ? 503 : 502
    );
  }
}
