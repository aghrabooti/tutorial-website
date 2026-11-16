import { fileInfo, readFileResponse, validFileSignature, writeFileResponse } from "../../../../lib/file-store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, context) {
  const [bucket, ...segments] = (await context.params).object;
  const key = segments.join("/");
  const info = fileInfo(bucket, key);
  if (!info) return new Response(null, { status: 404 });
  if (info.private && !validFileSignature(request, "GET", bucket, key)) {
    return new Response(null, { status: 403 });
  }
  return readFileResponse(bucket, key, info);
}

export async function PUT(request, context) {
  const [bucket, ...segments] = (await context.params).object;
  const key = segments.join("/");
  const info = fileInfo(bucket, key);
  if (!info) return new Response(null, { status: 404 });
  if (!validFileSignature(request, "PUT", bucket, key)) return new Response(null, { status: 403 });
  return writeFileResponse(request, bucket, key, info);
}
