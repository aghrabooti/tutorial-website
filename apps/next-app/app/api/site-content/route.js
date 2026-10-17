import { readSiteContent } from "../../../lib/site-content.js";

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
    return json(await readSiteContent());
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/site-content] Request failed:", error?.message ?? error);
    return json(
      {
        success: false,
        content: {},
        error: missingConfig ? "سرویس محتوا موقتاً تنظیم نشده است" : "خطا در خواندن محتوا",
      },
      missingConfig ? 503 : 502
    );
  }
}
