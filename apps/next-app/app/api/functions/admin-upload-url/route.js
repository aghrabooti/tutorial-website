import { createServiceSupabaseClient, requiredEnv } from "../../../../lib/supabase-server.js";
import { jsonNoStore, isValidSessionToken } from "../../../../lib/session-token.js";
import { findActiveAdmin } from "../../../../lib/admin-auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILES_BUCKET = "course-files";
const IMAGES_BUCKET = "course-images";

function safeFilename(value) {
  return String(value ?? "image")
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]/g, "-")
    .replace(/-+/g, "-");
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "درخواست نامعتبر است" }, 400);
  }

  const token = body?.token;
  const kind = body?.kind;
  if (!isValidSessionToken(token)) return jsonNoStore({ error: "توکن ارسال نشده" }, 401);

  try {
    const supabase = createServiceSupabaseClient();
    const auth = await findActiveAdmin(supabase, token);
    if (!auth.admin) return jsonNoStore({ error: "دسترسی غیرمجاز — فقط مدیر" }, 403);

    if (kind === "pdf") {
      const courseId = body?.course_id;
      if (!courseId) return jsonNoStore({ error: "دوره انتخاب نشده است" }, 400);

      const path = `${courseId}.pdf`;
      const { data, error } = await supabase.storage
        .from(FILES_BUCKET)
        .createSignedUploadUrl(path, { upsert: true });
      if (error || !data?.signedUrl) {
        console.error("[api/functions/admin-upload-url] PDF signed URL failed:", error);
        return jsonNoStore({ error: "خطا در ساخت لینک آپلود" }, 500);
      }
      return jsonNoStore({ success: true, upload_url: data.signedUrl, path });
    }

    if (kind === "site" || kind === "image") {
      const bucket = IMAGES_BUCKET;
      const folder = kind === "site" ? "site" : "courses";
      const path = `${folder}/${Date.now()}-${safeFilename(body?.filename)}`;
      const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
      if (error || !data?.signedUrl) {
        console.error("[api/functions/admin-upload-url] Image signed URL failed:", error);
        return jsonNoStore({ error: "خطا در ساخت لینک آپلود" }, 500);
      }

      const publicUrl = `${requiredEnv("SUPABASE_URL").replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${path}`;
      return jsonNoStore({ success: true, upload_url: data.signedUrl, path, public_url: publicUrl });
    }

    return jsonNoStore({ error: "نوع آپلود نامعتبر است" }, 400);
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/admin-upload-url] Request failed:", error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس آپلود تنظیم نشده است" : error?.message ?? "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
