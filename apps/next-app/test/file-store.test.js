import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { GET, PUT } from "../app/api/files/[...object]/route.js";
import { createFileStore } from "../lib/file-store.js";

test("local uploads require a signed PUT and private PDFs require a distinct signed GET", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "tutorial-storage-"));
  const previous = {
    FILE_SIGNING_SECRET: process.env.FILE_SIGNING_SECRET,
    FILE_STORAGE_DIR: process.env.FILE_STORAGE_DIR,
  };
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });
  process.env.FILE_SIGNING_SECRET = "s".repeat(64);
  process.env.FILE_STORAGE_DIR = root;

  const origin = "http://localhost";
  const bucket = "course-files";
  const key = "course-1.pdf";
  const context = { params: Promise.resolve({ object: [bucket, key] }) };
  const store = createFileStore().from(bucket);
  const { data: upload } = await store.createSignedUploadUrl(key);
  const unsigned = new URL(upload.signedUrl, origin).pathname;
  const pdf = "%PDF-1.7\nfixture";
  const uploadRequest = (url) => new Request(origin + url, { method: "PUT", body: pdf });

  assert.equal((await PUT(uploadRequest(unsigned), context)).status, 403);
  assert.equal((await PUT(uploadRequest(upload.signedUrl), context)).status, 204);
  assert.equal((await GET(new Request(origin + upload.signedUrl), context)).status, 403);
  assert.equal((await GET(new Request(origin + unsigned), context)).status, 403);

  const { data: download } = await store.createSignedUrl(key, 120);
  const response = await GET(new Request(origin + download.signedUrl), context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(await response.text(), pdf);
  assert.equal((await GET(
    new Request(origin + download.signedUrl),
    { params: Promise.resolve({ object: [bucket, "another-course.pdf"] }) },
  )).status, 403);
  assert.ok((await store.createSignedUploadUrl("../outside.pdf")).error);
});
