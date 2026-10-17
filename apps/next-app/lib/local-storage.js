import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const DEFAULT_TOTAL_LIMIT = 1024 * 1024 * 1024;
const MAX_TOKEN_TTL_SECONDS = 10 * 60;
const IMAGE_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);
let uploadLock = Promise.resolve();

export class LocalStorageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "LocalStorageError";
    this.status = status;
  }
}

function signingSecret() {
  const secret = process.env.STORAGE_SIGNING_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("Missing server environment variable: STORAGE_SIGNING_SECRET (must contain at least 32 bytes)");
  }
  return secret;
}

export function getStorageRoot() {
  return resolve(/*turbopackIgnore: true*/ process.env.STORAGE_ROOT?.trim() || join(process.cwd(), ".storage"));
}

export function maxStorageBytes() {
  const configured = Number.parseInt(process.env.STORAGE_MAX_BYTES ?? "", 10);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_TOTAL_LIMIT;
}

export function safeImageFilename(filename, contentType) {
  const extension = IMAGE_TYPES.get(String(contentType ?? "").toLowerCase());
  if (!extension) throw new LocalStorageError("نوع تصویر پشتیبانی نمی‌شود", 415);

  const input = String(filename ?? "image")
    .replace(/\\/g, "/")
    .split("/")
    .at(-1) ?? "image";
  const stem = input
    .replace(/\.[^.]*$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "image";
  return `${stem}${extension}`;
}

function isSafeObjectPath(bucket, objectPath) {
  if (typeof objectPath !== "string" || objectPath.length > 220) return false;
  if (objectPath.includes("\\") || objectPath.includes("\0")) return false;
  if (objectPath.split("/").some((part) => !part || part === "." || part === "..")) return false;

  if (bucket === "course-files") {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i.test(objectPath);
  }
  if (bucket === "course-images") {
    return /^(site|courses)\/[a-z0-9][a-z0-9._-]{0,119}\.(jpg|jpeg|png|webp|gif)$/i.test(objectPath);
  }
  return false;
}

function signature(encodedPayload) {
  return createHmac("sha256", signingSecret())
    .update(encodedPayload, "utf8")
    .digest("base64url");
}

export function createStorageToken({ action, bucket, path, maxBytes, overwrite = false, ttlSeconds = 300 }) {
  if (!new Set(["upload", "download"]).has(action)) throw new TypeError("Invalid storage token action");
  if (!isSafeObjectPath(bucket, path)) throw new TypeError("Invalid storage object path");
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError("Invalid storage token size limit");
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TOKEN_TTL_SECONDS) {
    throw new TypeError("Invalid storage token expiry");
  }

  const payload = Buffer.from(JSON.stringify({
    version: 1,
    action,
    bucket,
    path,
    maxBytes,
    overwrite: Boolean(overwrite),
    expiresAt: Date.now() + ttlSeconds * 1000,
    nonce: randomUUID(),
  })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyStorageToken(token, expectedAction) {
  if (typeof token !== "string" || token.length > 4096) {
    throw new LocalStorageError("لینک ذخیره‌سازی معتبر نیست", 401);
  }
  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    throw new LocalStorageError("لینک ذخیره‌سازی معتبر نیست", 401);
  }

  const encodedPayload = token.slice(0, separator);
  const suppliedSignature = Buffer.from(token.slice(separator + 1), "base64url");
  const expectedSignature = Buffer.from(signature(encodedPayload), "base64url");
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new LocalStorageError("لینک ذخیره‌سازی معتبر نیست", 401);
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new LocalStorageError("لینک ذخیره‌سازی معتبر نیست", 401);
  }

  if (
    claims?.version !== 1 ||
    claims.action !== expectedAction ||
    !isSafeObjectPath(claims.bucket, claims.path) ||
    !Number.isSafeInteger(claims.maxBytes) ||
    claims.maxBytes <= 0 ||
    !Number.isFinite(claims.expiresAt) ||
    claims.expiresAt <= Date.now()
  ) {
    throw new LocalStorageError("لینک ذخیره‌سازی منقضی یا نامعتبر است", 401);
  }
  return claims;
}

export function resolveStorageFile(bucket, objectPath) {
  if (!isSafeObjectPath(bucket, objectPath)) {
    throw new LocalStorageError("مسیر فایل نامعتبر است", 400);
  }
  const root = getStorageRoot();
  const target = resolve(root, bucket, objectPath);
  if (!target.startsWith(`${root}${sep}`)) {
    throw new LocalStorageError("مسیر فایل نامعتبر است", 400);
  }
  return target;
}

async function directorySize(directory) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySize(path);
    else if (entry.isFile() && !entry.name.endsWith(".uploading")) {
      total += (await stat(path)).size;
    }
  }
  return total;
}

async function withUploadLock(work) {
  const previous = uploadLock;
  let release;
  uploadLock = new Promise((resolveLock) => { release = resolveLock; });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

function allowedContentType(bucket, objectPath, supplied) {
  const type = String(supplied ?? "").split(";", 1)[0].trim().toLowerCase();
  if (bucket === "course-files") return type === "application/pdf" ? type : null;
  if (!IMAGE_TYPES.has(type)) return null;
  const extension = objectPath.slice(objectPath.lastIndexOf(".")).toLowerCase();
  return IMAGE_TYPES.get(type) === extension ? type : null;
}

export async function saveUploadedFile(request, claims) {
  const { bucket, path: objectPath, maxBytes, overwrite } = claims;
  const contentType = allowedContentType(bucket, objectPath, request.headers.get("content-type"));
  if (!contentType) throw new LocalStorageError("نوع فایل با مسیر آپلود سازگار نیست", 415);

  const lengthHeader = request.headers.get("content-length");
  const declaredLength = lengthHeader ? Number(lengthHeader) : null;
  if (declaredLength !== null && (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > maxBytes)) {
    throw new LocalStorageError("حجم فایل از حد مجاز بیشتر است", 413);
  }
  if (!request.body) throw new LocalStorageError("فایل ارسال نشده است", 400);

  return withUploadLock(async () => {
    const destination = resolveStorageFile(bucket, objectPath);
    await mkdir(dirname(destination), { recursive: true, mode: bucket === "course-files" ? 0o700 : 0o755 });
    const temporary = `${destination}.${randomUUID()}.uploading`;
    let previousSize = 0;
    try {
      previousSize = (await stat(/*turbopackIgnore: true*/ destination)).size;
      if (!overwrite) throw new LocalStorageError("فایل از قبل وجود دارد", 409);
    } catch (error) {
      if (error instanceof LocalStorageError) throw error;
      if (error?.code !== "ENOENT") throw error;
    }

    let bytesWritten = 0;
    const sizeGuard = new Transform({
      transform(chunk, encoding, callback) {
        bytesWritten += chunk.length;
        if (bytesWritten > maxBytes) callback(new LocalStorageError("حجم فایل از حد مجاز بیشتر است", 413));
        else callback(null, chunk);
      },
    });

    try {
      await pipeline(
        Readable.fromWeb(request.body),
        sizeGuard,
        createWriteStream(temporary, { flags: "wx", mode: bucket === "course-files" ? 0o600 : 0o644 })
      );
      if (bytesWritten === 0) throw new LocalStorageError("فایل خالی است", 400);

      const currentSize = await directorySize(getStorageRoot());
      if (currentSize - previousSize + bytesWritten > maxStorageBytes()) {
        throw new LocalStorageError("سقف فضای ذخیره‌سازی پر شده است", 507);
      }
      if (!overwrite && previousSize > 0) throw new LocalStorageError("فایل از قبل وجود دارد", 409);

      await rename(temporary, destination);
      return { bucket, path: objectPath, size: bytesWritten, contentType };
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  });
}

export async function getStorageFileStat(bucket, objectPath) {
  const target = resolveStorageFile(bucket, objectPath);
  const fileStat = await stat(/*turbopackIgnore: true*/ target).catch((error) => {
    if (error?.code === "ENOENT") throw new LocalStorageError("فایل پیدا نشد", 404);
    throw error;
  });
  if (!fileStat.isFile()) throw new LocalStorageError("فایل پیدا نشد", 404);
  return { target, size: fileStat.size, name: basename(target) };
}

export function publicStorageUrl(path) {
  if (!isSafeObjectPath("course-images", path)) throw new TypeError("Invalid public image path");
  return `/storage/course-images/${path.split("/").map(encodeURIComponent).join("/")}`;
}
