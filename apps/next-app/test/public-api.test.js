import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { GET as getCourses } from "../app/api/courses/route.js";
import { POST as getCourse } from "../app/api/functions/get-course/route.js";
import { GET as getSiteContent } from "../app/api/site-content/route.js";

const envKeys = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

function setTestEnv({ serviceRole = false } = {}) {
  process.env.SUPABASE_URL = "https://project.supabase.test";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  if (serviceRole) process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

test("GET /api/courses reads public rows with the anon key and preserves the client shape", async () => {
  setTestEnv();
  let requestedUrl;
  let requestedKey;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedKey = new Headers(init?.headers).get("apikey");
    return Response.json([{ id: "course-1", title: "آزمون" }]);
  };

  const response = await getCourses();
  assert.equal(response.status, 200);
  assert.equal(requestedKey, "test-anon-key");
  assert.match(requestedUrl, /\/rest\/v1\/courses\?select=\*/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    data: [{ id: "course-1", title: "آزمون" }],
    error: null,
  });
});

test("GET /api/courses fails closed when the server is not configured", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  globalThis.fetch = async () => {
    throw new Error("fetch should not run without configuration");
  };

  const response = await getCourses();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    data: null,
    error: { message: "سرویس محصولات موقتاً در دسترس نیست" },
  });
});

test("POST /api/functions/get-course keeps the previous response contract", async () => {
  setTestEnv();
  let requestedUrl;
  let requestedKey;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedKey = new Headers(init?.headers).get("apikey");
    return Response.json({
      id: "course-2",
      title: "دوره‌ی آزمایشی",
      description: "توضیح",
      image_url: "/cover.jpg",
      price: 100,
      type: "course",
    });
  };

  const request = new Request("http://localhost/api/functions/get-course", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ course_id: "course-2" }),
  });
  const response = await getCourse(request);

  assert.equal(response.status, 200);
  assert.equal(requestedKey, "test-anon-key");
  assert.match(requestedUrl, /\/rest\/v1\/courses\?/);
  assert.match(requestedUrl, /id=eq\.course-2/);
  assert.deepEqual(await response.json(), {
    success: true,
    course: {
      id: "course-2",
      title: "دوره‌ی آزمایشی",
      description: "توضیح",
      image_url: "/cover.jpg",
      price: 100,
      type: "course",
    },
  });
});

test("POST /api/functions/get-course validates input before querying Supabase", async () => {
  const request = new Request("http://localhost/api/functions/get-course", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const response = await getCourse(request);

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "missing course id",
  });
});

test("GET /api/site-content performs a fixed read and returns only the public content map", async () => {
  setTestEnv({ serviceRole: true });
  let requestedKey;
  let requestedUrl;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedKey = new Headers(init?.headers).get("apikey");
    return Response.json([
      { key: "home.title", value: "عنوان", updated_at: "2026-01-02T00:00:00.000Z" },
      { key: "home.empty", value: "", updated_at: "2026-01-03T00:00:00.000Z" },
      { key: "home.note", value: "یادداشت", updated_at: "2026-01-01T00:00:00.000Z" },
    ]);
  };

  const response = await getSiteContent();
  assert.equal(response.status, 200);
  assert.equal(requestedKey, "test-service-role-key");
  assert.match(requestedUrl, /\/rest\/v1\/site_content\?select=key%2Cvalue%2Cupdated_at/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    success: true,
    content: { "home.title": "عنوان", "home.note": "یادداشت" },
    updated_at: "2026-01-02T00:00:00.000Z",
  });
});
