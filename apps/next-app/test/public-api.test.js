import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { GET as getCourses } from "../app/api/courses/route.js";
import { POST as getCourse } from "../app/api/functions/get-course/route.js";
import { GET as getSiteContent } from "../app/api/site-content/route.js";
import {
  installPostgresPoolForTests,
  resetPostgresPoolForTests,
} from "../lib/postgres.js";

const envKeys = ["DATABASE_URL"];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

function setPostgresPool(handler) {
  const pool = {
    async query(text, values = []) {
      return handler(text, values);
    },
  };
  installPostgresPoolForTests(pool);
  return pool;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetPostgresPoolForTests();
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

test("GET /api/courses reads public rows from PostgreSQL and preserves the client shape", async () => {
  let executedSql;
  let values;
  setPostgresPool(async (text, params) => {
    executedSql = text;
    values = params;
    return { rows: [{ id: "course-1", title: "آزمون" }], rowCount: 1 };
  });

  const response = await getCourses();
  assert.equal(response.status, 200);
  assert.match(executedSql, /SELECT \* FROM public\.courses/i);
  assert.deepEqual(values, []);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    data: [{ id: "course-1", title: "آزمون" }],
    error: null,
  });
});

test("GET /api/courses fails closed when the database is not configured", async () => {
  resetPostgresPoolForTests();
  delete process.env.DATABASE_URL;
  globalThis.fetch = async () => {
    throw new Error("The route must not make an external request");
  };

  const response = await getCourses();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    data: null,
    error: { message: "سرویس محصولات موقتاً در دسترس نیست" },
  });
});

test("POST /api/functions/get-course queries PostgreSQL and keeps the response contract", async () => {
  let executedSql;
  let values;
  const course = {
    id: "course-2",
    title: "دوره‌ی آزمایشی",
    description: "توضیح",
    image_url: "/cover.jpg",
    price: 100,
    type: "course",
  };
  setPostgresPool(async (text, params) => {
    executedSql = text;
    values = params;
    return { rows: [course], rowCount: 1 };
  });

  const request = new Request("http://localhost/api/functions/get-course", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ course_id: "course-2" }),
  });
  const response = await getCourse(request);

  assert.equal(response.status, 200);
  assert.match(executedSql, /FROM public\.courses\s+WHERE id = \$1/i);
  assert.deepEqual(values, ["course-2"]);
  assert.deepEqual(await response.json(), { success: true, course });
});

test("POST /api/functions/get-course validates input before querying PostgreSQL", async () => {
  let queryCount = 0;
  setPostgresPool(async () => {
    queryCount++;
    return { rows: [], rowCount: 0 };
  });
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
  assert.equal(queryCount, 0);
});

test("GET /api/site-content reads public content from PostgreSQL without Supabase credentials", async () => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
  let executedSql;
  setPostgresPool(async (text) => {
    executedSql = text;
    return {
      rows: [
        { key: "home.title", value: "عنوان", updated_at: new Date("2026-01-02T00:00:00.000Z") },
        { key: "home.empty", value: "", updated_at: new Date("2026-01-03T00:00:00.000Z") },
        { key: "home.note", value: "یادداشت", updated_at: new Date("2026-01-01T00:00:00.000Z") },
      ],
      rowCount: 3,
    };
  });

  const response = await getSiteContent();
  assert.equal(response.status, 200);
  assert.match(executedSql, /FROM public\.site_content/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    success: true,
    content: { "home.title": "عنوان", "home.note": "یادداشت" },
    updated_at: "2026-01-02T00:00:00.000Z",
  });
});
