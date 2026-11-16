import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const imageTypes = new Map([
  ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["png", "image/png"],
  ["webp", "image/webp"], ["gif", "image/gif"], ["avif", "image/avif"],
]);

export function fileInfo(bucket, key) {
  if (bucket === "course-files" && /^[\w-]+\.pdf$/.test(key)) {
    return { type: "application/pdf", maxBytes: 50 * 1024 ** 2, private: true };
  }
  if (bucket === "course-images" && /^(site|courses)\/[\w.-]+$/.test(key)) {
    const type = imageTypes.get(path.extname(key).slice(1).toLowerCase());
    if (type) return { type, maxBytes: 10 * 1024 ** 2, private: false };
  }
  return null;
}

export function fileUrl(bucket, key) {
  return `/api/files/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function signature(method, bucket, key, expires) {
  const secret = process.env.FILE_SIGNING_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Missing server environment variable: FILE_SIGNING_SECRET");
  }
  return createHmac("sha256", secret)
    .update(JSON.stringify([method, bucket, key, expires]))
    .digest("hex");
}

function signedUrl(method, bucket, key, ttl) {
  const expires = String(Math.floor(Date.now() / 1000) + ttl);
  return `${fileUrl(bucket, key)}?expires=${expires}&signature=${signature(method, bucket, key, expires)}`;
}

export function validFileSignature(request, method, bucket, key) {
  const { searchParams } = new URL(request.url);
  const expires = searchParams.get("expires") ?? "";
  const supplied = searchParams.get("signature") ?? "";
  if (!/^\d+$/.test(expires) || Number(expires) <= Date.now() / 1000 || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(signature(method, bucket, key, expires), "hex"));
}

function filePath(bucket, key) {
  return path.join(/* turbopackIgnore: true */ process.env.FILE_STORAGE_DIR || "./var/files", bucket, key);
}

export function createFileStore() {
  return {
    from(bucket) {
      return {
        async createSignedUploadUrl(key) {
          if (!fileInfo(bucket, key)) return { error: { message: "Invalid file name or type" } };
          return { data: { signedUrl: signedUrl("PUT", bucket, key, 600) }, error: null };
        },
        async createSignedUrl(key, ttl) {
          if (!fileInfo(bucket, key)) return { error: { message: "Invalid file name or type" } };
          try {
            if (!(await stat(/* turbopackIgnore: true */ filePath(bucket, key))).isFile()) return { error: { message: "File not found" } };
            return { data: { signedUrl: signedUrl("GET", bucket, key, ttl) }, error: null };
          } catch (error) {
            if (error.code === "ENOENT") return { error: { message: "File not found" } };
            throw error;
          }
        },
      };
    },
  };
}

export async function readFileResponse(bucket, key, info) {
  const target = filePath(bucket, key);
  try {
    const file = await stat(/* turbopackIgnore: true */ target);
    if (!file.isFile()) return new Response(null, { status: 404 });
    return new Response(Readable.toWeb(createReadStream(/* turbopackIgnore: true */ target)), {
      headers: {
        "Content-Type": info.type,
        "Content-Length": String(file.size),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": info.private ? "private, no-store" : "public, max-age=3600",
        ...(info.private ? { "Content-Disposition": `attachment; filename="${key}"` } : {}),
      },
    });
  } catch (error) {
    if (error.code === "ENOENT") return new Response(null, { status: 404 });
    throw error;
  }
}

export async function writeFileResponse(request, bucket, key, info) {
  if (!request.body || Number(request.headers.get("content-length")) > info.maxBytes) {
    return new Response(null, { status: request.body ? 413 : 400 });
  }
  const target = filePath(bucket, key);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(target), { recursive: true });
  let size = 0;
  const limit = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > info.maxBytes) return callback(Object.assign(new Error("Upload too large"), { code: "FILE_LIMIT" }));
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(request.body), limit, createWriteStream(/* turbopackIgnore: true */ temporary, { flags: "wx", mode: 0o600 }));
    if (!size) return new Response(null, { status: 400 });
    await rename(temporary, target);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error.code === "FILE_LIMIT") return new Response(null, { status: 413 });
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}
