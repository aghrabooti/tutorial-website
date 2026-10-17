import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { POST as getCourseFile } from "../app/api/functions/get-course-file/route.js";
import { POST as getCourseSessions } from "../app/api/functions/get-course-sessions/route.js";
import { GET as downloadLocalFile } from "../app/api/storage/download/route.js";
import {
  installPostgresPoolForTests,
  resetPostgresPoolForTests,
} from "../lib/postgres.js";
import { hashSessionToken } from "../lib/session-token.js";
import { verifyStorageToken } from "../lib/local-storage.js";

const envKeys = ["DATABASE_URL", "STORAGE_ROOT", "STORAGE_SIGNING_SECRET"];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const session = { id: "session-1", user_id: "user-1", expires_at: "2099-01-01T00:00:00.000Z" };
const courseId = "11111111-1111-4111-8111-111111111111";
let storageRoot;

function setTestEnv() {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
  process.env.STORAGE_SIGNING_SECRET = "test-storage-signing-secret-".padEnd(64, "x");
}

async function setupStorage() {
  storageRoot = await mkdtemp(join(tmpdir(), "tutorial-course-files-"));
  process.env.STORAGE_ROOT = storageRoot;
  await mkdir(join(storageRoot, "course-files"), { recursive: true });
  await mkdir(join(storageRoot, "course-images"), { recursive: true });
}

function installPostgres({ owns = true, sessions = [] } = {}) {
  const queries = [];
  const runQuery = async (text, values = []) => {
    queries.push({ text, values });
    if (text.includes("FROM public.user_sessions")) {
      return { rows: [{ ...session, expired: false }], rowCount: 1 };
    }
    if (text.includes("FROM public.site_users")) {
      return { rows: [{ id: "user-1" }], rowCount: 1 };
    }
    if (text.includes("FROM public.orders")) {
      return { rows: owns ? [{ owned: 1 }] : [], rowCount: owns ? 1 : 0 };
    }
    if (text.includes("FROM public.course_sessions")) return { rows: sessions, rowCount: sessions.length };
    throw new Error(`Unexpected SQL: ${text}`);
  };
  installPostgresPoolForTests({ query: runQuery });
  return queries;
}

function makeRequest(body) {
  return new Request("http://localhost/api/functions/course-entitlement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  globalThis.fetch = originalFetch;
  resetPostgresPoolForTests();
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  if (storageRoot) {
    await rm(storageRoot, { recursive: true, force: true });
    storageRoot = undefined;
  }
});

test("get-course-file checks paid ownership before returning a short-lived local download URL", async () => {
  setTestEnv();
  await setupStorage();
  const path = `${courseId}.pdf`;
  const pdf = Buffer.from("%PDF-1.4\nprivate fixture\n%%EOF");
  await writeFile(join(storageRoot, "course-files", path), pdf, { mode: 0o600 });
  const queries = installPostgres();
  globalThis.fetch = async () => {
    throw new Error("get-course-file must not call Supabase");
  };

  const response = await getCourseFile(makeRequest({ token: "valid-session-token", course_id: courseId }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  const downloadUrl = new URL(body.url, "http://localhost");
  assert.equal(downloadUrl.pathname, "/api/storage/download");
  const claims = verifyStorageToken(downloadUrl.searchParams.get("token"), "download");
  assert.equal(claims.bucket, "course-files");
  assert.equal(claims.path, path);
  assert.equal(claims.maxBytes, 100 * 1024 * 1024);
  const ownershipQuery = queries.find((query) => query.text.includes("FROM public.orders"));
  assert.ok(ownershipQuery);
  assert.deepEqual(ownershipQuery.values, ["user-1", courseId]);
  assert.deepEqual(queries[0].values, [hashSessionToken("valid-session-token")]);
  assert.equal(queries.some((query) => query.text.includes("FROM public.site_users")), true);

  const downloadResponse = await downloadLocalFile(new Request(downloadUrl));
  assert.equal(downloadResponse.status, 200);
  assert.deepEqual(Buffer.from(await downloadResponse.arrayBuffer()), pdf);

  const deniedQueries = installPostgres({ owns: false });
  const denied = await getCourseFile(makeRequest({ token: "valid-session-token", course_id: courseId }));
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: "این فایل فقط برای خریداران فعال است" });
  assert.equal(deniedQueries.some((query) => query.text.includes("FROM public.orders")), true);
});

test("get-course-file rejects missing files and never creates a download token for a non-owner", async () => {
  setTestEnv();
  await setupStorage();
  installPostgres();

  const missing = await getCourseFile(makeRequest({ token: "valid-session-token", course_id: courseId }));
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "فایل این محصول هنوز بارگذاری نشده است" });

  installPostgres({ owns: false });
  const notOwner = await getCourseFile(makeRequest({ token: "valid-session-token", course_id: "22222222-2222-4222-8222-222222222222" }));
  assert.equal(notOwner.status, 403);
});

test("get-course-sessions protects ownership and only reveals online links in the five-minute window", async () => {
  setTestEnv();
  const futureStart = new Date(Date.now() + 10 * 60_000).toISOString();
  const activeStart = new Date(Date.now() + 3 * 60_000).toISOString();
  const sessionRows = [
    { id: "s1", course_id: courseId, session_number: 1, is_online: true, online_url: "https://meet.example/early", scheduled_at: futureStart },
    { id: "s2", course_id: courseId, session_number: 2, is_online: true, online_url: "https://meet.example/open", scheduled_at: activeStart },
    { id: "s3", course_id: courseId, session_number: 3, is_online: false, video_url: "/lesson.mp4", online_url: null, scheduled_at: null },
  ];
  const queries = installPostgres({ sessions: sessionRows });
  globalThis.fetch = async () => {
    throw new Error("get-course-sessions must not call Supabase");
  };

  const response = await getCourseSessions(makeRequest({ token: "valid-session-token", course_id: courseId }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.sessions[0].online_url, null);
  assert.equal(body.sessions[0].online_available, false);
  assert.equal(body.sessions[1].online_url, "https://meet.example/open");
  assert.equal(body.sessions[1].online_available, true);
  assert.equal(body.sessions[2].online_available, true);
  assert.ok(Number.isFinite(Date.parse(body.server_now)));
  const sessionsQuery = queries.find((query) => query.text.includes("FROM public.course_sessions"));
  assert.ok(sessionsQuery);
  assert.deepEqual(sessionsQuery.values, [courseId]);

  const deniedQueries = installPostgres({ owns: false, sessions: sessionRows });
  const denied = await getCourseSessions(makeRequest({ token: "valid-session-token", course_id: courseId }));
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: "دسترسی فقط برای خریداران است" });
  assert.equal(
    deniedQueries.some((query) => query.text.includes("FROM public.course_sessions")),
    false,
    "unowned courses must not read their session links"
  );
});
