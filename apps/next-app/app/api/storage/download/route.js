import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { LocalStorageError, getStorageFileStat, verifyStorageToken } from "../../../../lib/local-storage.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message, status) {
  return Response.json({ error: message }, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET(request) {
  const token = new URL(request.url).searchParams.get("token");
  try {
    const claims = verifyStorageToken(token, "download");
    if (claims.bucket !== "course-files") return errorResponse("فایل پیدا نشد", 404);

    const file = await getStorageFileStat(claims.bucket, claims.path);
    if (file.size > claims.maxBytes) return errorResponse("فایل پیدا نشد", 404);

    const stream = createReadStream(file.target, { highWaterMark: 64 * 1024 });
    return new Response(Readable.toWeb(stream), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${file.name}"`,
        "Content-Length": String(file.size),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof LocalStorageError) return errorResponse(error.message, error.status);
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/storage/download] Download failed:", error?.message ?? error);
    return errorResponse(missingConfig ? "سرویس ذخیره‌سازی تنظیم نشده است" : "دانلود فایل انجام نشد", missingConfig ? 503 : 500);
  }
}
