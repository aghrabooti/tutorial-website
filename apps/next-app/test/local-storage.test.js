import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { PUT as upload } from "../app/api/storage/upload/route.js";
import { GET as download } from "../app/api/storage/download/route.js";
import {
  createStorageToken,
  getStorageRoot,
  LocalStorageError,
  safeImageFilename,
  verifyStorageToken,
} from "../lib/local-storage.js";

const envKeys = ["STORAGE_ROOT", "STORAGE_MAX_BYTES", "STORAGE_SIGNING_SECRET"];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
let storageRoot;
const courseId = "11111111-1111-4111-8111-111111111111";

async function setupStorage() {
  storageRoot = await mkdtemp(join(tmpdir(), "tutorial-local-storage-"));
  await mkdir(join(storageRoot, "course-files"), { recursive: true });
  await mkdir(join(storageRoot, "course-images"), { recursive: true });
  process.env.STORAGE_ROOT = storageRoot;
  process.env.STORAGE_MAX_BYTES = String(1024 * 1024);
  process.env.STORAGE_SIGNING_SECRET = "test-storage-signing-secret-".padEnd(64, "x");
}

function requestWithBody(body, contentType, token) {
  return new Request("http://localhost/api/storage/upload", {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
}

afterEach(async () => {
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  if (storageRoot) {
    await rm(storageRoot, { recursive: true, force: true });
    storageRoot = undefined;
  }
});

test("local storage tokens are signed, action-scoped, and reject tampering", async () => {
  await setupStorage();
  const token = createStorageToken({
    action: "upload",
    bucket: "course-files",
    path: `${courseId}.pdf`,
    maxBytes: 1024,
  });

  const claims = verifyStorageToken(token, "upload");
  assert.equal(claims.bucket, "course-files");
  assert.equal(claims.path, `${courseId}.pdf`);
  assert.throws(() => verifyStorageToken(token, "download"), LocalStorageError);
  assert.throws(() => verifyStorageToken(`${token.slice(0, -1)}x`, "upload"), LocalStorageError);
  assert.throws(() => createStorageToken({
    action: "upload",
    bucket: "course-files",
    path: "../../etc/passwd",
    maxBytes: 1024,
  }), TypeError);
});

test("local storage safely normalizes image filenames and rejects unsupported types", async () => {
  await setupStorage();
  assert.equal(safeImageFilename("../Cover Photo.JPG", "image/jpeg"), "cover-photo.jpg");
  assert.equal(safeImageFilename("logo.png", "image/png"), "logo.png");
  assert.throws(() => safeImageFilename("malicious.svg", "image/svg+xml"), LocalStorageError);
});

test("signed upload streams a private PDF into the persistent course-files directory", async () => {
  await setupStorage();
  const token = createStorageToken({
    action: "upload",
    bucket: "course-files",
    path: `${courseId}.pdf`,
    maxBytes: 4096,
  });
  const payload = Buffer.from("%PDF-1.4\nself-hosted fixture\n%%EOF");

  const response = await upload(requestWithBody(payload, "application/pdf", token));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, size: payload.length });
  assert.deepEqual(
    await readFile(join(storageRoot, "course-files", `${courseId}.pdf`)),
    payload
  );
});

test("upload route rejects missing authorization, wrong MIME types, and oversized content", async () => {
  await setupStorage();
  const token = createStorageToken({
    action: "upload",
    bucket: "course-files",
    path: `${courseId}.pdf`,
    maxBytes: 8,
  });

  const unauthorized = await upload(requestWithBody(Buffer.from("pdf"), "application/pdf"));
  const wrongType = await upload(requestWithBody(Buffer.from("image"), "image/png", token));
  const oversized = await upload(requestWithBody(Buffer.from("123456789"), "application/pdf", token));

  assert.equal(unauthorized.status, 401);
  assert.equal(wrongType.status, 415);
  assert.equal(oversized.status, 413);
});

test("local storage enforces the total quota and refuses overwriting public images", async () => {
  await setupStorage();
  process.env.STORAGE_MAX_BYTES = "5";
  const pdfToken = createStorageToken({
    action: "upload",
    bucket: "course-files",
    path: `${courseId}.pdf`,
    maxBytes: 20,
  });
  const quotaResponse = await upload(requestWithBody(Buffer.from("123456"), "application/pdf", pdfToken));
  assert.equal(quotaResponse.status, 507);

  const imagePath = "courses/one-off.jpg";
  await mkdir(join(storageRoot, "course-images", "courses"), { recursive: true });
  const imageToken = createStorageToken({
    action: "upload",
    bucket: "course-images",
    path: imagePath,
    maxBytes: 20,
  });
  await writeFile(join(storageRoot, "course-images", imagePath), "image");
  const conflictResponse = await upload(requestWithBody(Buffer.from("image"), "image/jpeg", imageToken));
  assert.equal(conflictResponse.status, 409);
});

test("signed download streams only private PDF objects and sends no-store headers", async () => {
  await setupStorage();
  const path = `${courseId}.pdf`;
  const payload = Buffer.from("%PDF-1.4\nprivate file\n%%EOF");
  await writeFile(join(storageRoot, "course-files", path), payload, { recursive: true, mode: 0o600 });
  const token = createStorageToken({
    action: "download",
    bucket: "course-files",
    path,
    maxBytes: 4096,
  });

  const response = await download(new Request(
    `http://localhost/api/storage/download?token=${encodeURIComponent(token)}`
  ));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload);
  assert.equal(getStorageRoot(), storageRoot);
});
