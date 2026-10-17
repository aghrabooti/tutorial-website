import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { POST as getAdminCourses } from "../app/api/functions/admin-get-courses/route.js";
import { POST as getAdminSessions } from "../app/api/functions/admin-get-sessions/route.js";
import { POST as getAdminUsers } from "../app/api/functions/admin-users/route.js";
import { POST as getAdminOrders } from "../app/api/functions/admin-orders/route.js";
import { POST as createCourse } from "../app/api/functions/admin-create-course/route.js";
import { POST as updateCourse } from "../app/api/functions/admin-update-course/route.js";
import { POST as saveCourseSessions } from "../app/api/functions/admin-save-sessions/route.js";
import { POST as getAdminOverview } from "../app/api/functions/admin-overview/route.js";
import { POST as getAdminUploadUrl } from "../app/api/functions/admin-upload-url/route.js";
import { POST as updateSiteContent } from "../app/api/functions/site-content/route.js";
import { verifyStorageToken } from "../lib/local-storage.js";
import { hashSessionToken } from "../lib/session-token.js";
import {
  installPostgresPoolForTests,
  resetPostgresPoolForTests,
} from "../lib/postgres.js";

const envKeys = [
  "DATABASE_URL",
  "NODE_ENV",
  "STORAGE_SIGNING_SECRET",
  "ZARINPAL_MERCHANT_ID",
  "ZARINPAL_SANDBOX",
  "ZARINPAL_CALLBACK_URL",
  "PRICE_TO_RIAL_FACTOR",
];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const session = { id: "session-1", user_id: "admin-1", expires_at: "2099-01-01T00:00:00.000Z" };
const admin = { id: "admin-1", role: "admin" };

function setTestEnv() {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
  process.env.NODE_ENV = "test";
}

function makeRequest(path, body) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockPostgres(handler) {
  const requests = [];
  const runQuery = async (text, values = []) => {
    requests.push({ text, values });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text.trim())) return { rows: [], rowCount: 0 };
    return handler(text, values);
  };
  installPostgresPoolForTests({
    query: runQuery,
    async connect() {
      return { query: runQuery, release() {} };
    },
  });
  return requests;
}

function mockPostgresAdmin(respond, { role = "admin" } = {}) {
  return mockPostgres((text, values) => {
    if (text.includes("FROM public.user_sessions")) {
      return { rows: [{ id: session.id, user_id: admin.id, expired: false }], rowCount: 1 };
    }
    if (text.includes("FROM public.site_users") && /SELECT\s+id,\s*role/i.test(text)) {
      return { rows: role ? [{ ...admin, role }] : [], rowCount: role ? 1 : 0 };
    }
    return respond(text, values);
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetPostgresPoolForTests();
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

test("admin API rejects non-admin sessions before reading privileged data", async () => {
  setTestEnv();
  const requests = mockPostgresAdmin(() => {
    throw new Error("privileged query must not run for a student");
  }, { role: "student" });

  const response = await getAdminCourses(
    makeRequest("/api/functions/admin-get-courses", { token: "student-token" })
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "دسترسی غیرمجاز" });
  assert.equal(requests.length, 2);
});

test("POST /api/functions/admin-get-courses returns the established course fields", async () => {
  setTestEnv();
  const courses = [{ id: "course-1", title: "ریاضی", type: "course", price: 100 }];
  mockPostgresAdmin((text) => {
    if (text.includes("FROM public.courses")) return { rows: courses, rowCount: courses.length };
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await getAdminCourses(
    makeRequest("/api/functions/admin-get-courses", { token: "admin-token" })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, courses });
});

test("POST /api/functions/admin-get-sessions returns sessions ordered by sequence", async () => {
  setTestEnv();
  const sessions = [{ id: "s1", session_number: 1 }, { id: "s2", session_number: 2 }];
  const queries = mockPostgresAdmin((text, values) => {
    if (text.includes("FROM public.course_sessions")) {
      assert.deepEqual(values, ["course-1"]);
      return { rows: sessions, rowCount: sessions.length };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await getAdminSessions(
    makeRequest("/api/functions/admin-get-sessions", {
      token: "admin-token",
      course_id: "course-1",
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, sessions });
});

test("POST /api/functions/admin-users keeps the limited safe user projection", async () => {
  setTestEnv();
  const users = [{ id: "user-1", phone: "989120000000", first_name: "سارا", last_name: "رضایی", role: "student" }];
  mockPostgresAdmin((text) => {
    if (text.includes("FROM public.site_users") && text.includes("LIMIT 300")) {
      return { rows: users, rowCount: users.length };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await getAdminUsers(
    makeRequest("/api/functions/admin-users", { token: "admin-token" })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, users });
});

test("POST /api/functions/admin-orders decorates orders with customer and shipment data", async () => {
  setTestEnv();
  const customer = { id: "customer-1", first_name: "علی", last_name: "رضایی", phone: "989120000000" };
  const order = {
    id: "order-1",
    user_id: "customer-1",
    amount_rial: 250000,
    status: "paid",
    source: "zarinpal",
    items: [{ course_id: "book-1", title: "کتاب تست", requires_shipping: true }],
    course_ids: ["book-1"],
    ref_id: 98765,
    created_at: "2026-10-14T00:00:00.000Z",
  };
  const queries = mockPostgresAdmin((text) => {
    if (text.includes("FROM public.orders")) return { rows: [order], rowCount: 1 };
    if (text.includes("FROM public.courses")) {
      return { rows: [{ id: "book-1", type: "book", requires_shipping: true }], rowCount: 1 };
    }
    if (text.includes("FROM public.shipments")) {
      return { rows: [{ order_id: "order-1", status: "sent", tracking_code: "TR-1" }], rowCount: 1 };
    }
    if (text.includes("FROM public.site_users") && text.includes("first_name")) {
      return { rows: [customer], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await getAdminOrders(
    makeRequest("/api/functions/admin-orders", { token: "admin-token" })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.orders[0], {
    id: "order-1",
    created_at: order.created_at,
    status: "paid",
    source: "zarinpal",
    amount_rial: 250000,
    ref_id: 98765,
    user_name: "علی رضایی",
    user_phone: "989120000000",
    items: ["کتاب تست"],
    needs_shipping: true,
    shipment_status: "sent",
    tracking_code: "TR-1",
  });
  assert.ok(queries.some((query) => query.text.includes("FROM public.shipments")));
});

test("POST /api/functions/admin-create-course stores normalized optional fields and returns the created course", async () => {
  setTestEnv();
  const course = { id: "course-new", title: "ریاضی", type: "course", price: 120 };
  const queries = mockPostgresAdmin((text, values) => {
    if (text.includes("INSERT INTO public.courses")) {
      assert.deepEqual(values, ["ریاضی", "11", null, "course", null, 120, null, null, null]);
      return { rows: [course], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await createCourse(
    makeRequest("/api/functions/admin-create-course", {
      token: "admin-token",
      title: "ریاضی",
      type: "course",
      grade: "11",
      price: "120",
      discount_price: "",
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    course,
    message: "محتوا ساخته شد",
  });
  const insert = queries.find((query) => query.text.includes("INSERT INTO public.courses"));
  assert.deepEqual(insert.values, ["ریاضی", "11", null, "course", null, 120, null, null, null]);
});

test("POST /api/functions/admin-update-course only updates editable fields and converts empty values to null", async () => {
  setTestEnv();
  const queries = mockPostgresAdmin((text, values) => {
    if (text.startsWith("UPDATE public.courses")) {
      assert.match(text, /title = \$1, major = \$2 WHERE id = \$3/);
      assert.deepEqual(values, ["جبر", null, "course-1"]);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await updateCourse(
    makeRequest("/api/functions/admin-update-course", {
      token: "admin-token",
      course_id: "course-1",
      title: "جبر",
      major: "",
      role: "admin",
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    message: "دوره با موفقیت بروزرسانی شد",
  });
  const update = queries.find((query) => query.text.startsWith("UPDATE public.courses"));
  assert.deepEqual(update.values, ["جبر", null, "course-1"]);
});

test("POST /api/functions/admin-save-sessions deletes removed rows and upserts the validated list", async () => {
  setTestEnv();
  const queries = mockPostgresAdmin(async (text, values) => {
    if (text.startsWith("SELECT id FROM public.course_sessions")) {
      return { rows: [{ id: "session-1" }, { id: "session-deleted" }], rowCount: 2 };
    }
    if (text.startsWith("DELETE FROM public.course_sessions")) {
      assert.deepEqual(values, ["course-1", ["session-1"]]);
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("INSERT INTO public.course_sessions")) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await saveCourseSessions(
    makeRequest("/api/functions/admin-save-sessions", {
      token: "admin-token",
      course_id: "course-1",
      sessions: [
        { id: "session-1", session_number: "1", title: "مقدمه", is_online: true, online_url: " https://live.example/class " },
        { session_number: "2", title: "تمرین", video_url: " /video.mp4 ", is_online: false, online_url: "ignored" },
      ],
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  const deletion = queries.find((query) => query.text.startsWith("DELETE FROM public.course_sessions"));
  assert.deepEqual(deletion.values, ["course-1", ["session-1"]]);
  const upserts = queries.filter((query) => query.text.startsWith("INSERT INTO public.course_sessions"));
  assert.equal(upserts.length, 2);
  assert.deepEqual(upserts[0].values, ["session-1", "course-1", 1, "مقدمه", null, true, "https://live.example/class", null]);
  assert.deepEqual(upserts[1].values, ["course-1", 2, "تمرین", "/video.mp4", false, null, null]);
});

test("POST /api/functions/admin-overview reports sales, shipping gaps, and shared server-side gateway status", async () => {
  setTestEnv();
  process.env.ZARINPAL_MERCHANT_ID = "12345678-1234-1234-1234-123456789abc";
  process.env.ZARINPAL_SANDBOX = "false";
  process.env.ZARINPAL_CALLBACK_URL = "https://www.example.test/payment-result";
  process.env.PRICE_TO_RIAL_FACTOR = "10";
  const paidOrders = [
    { id: "order-book", amount_rial: 150, items: [{ course_id: "book-1" }], course_ids: ["book-1"] },
    { id: "order-course", amount_rial: 200, items: [{ course_id: "course-1" }], course_ids: ["course-1"] },
  ];
  const queries = mockPostgresAdmin((text) => {
    if (text.includes("COUNT(*)::int AS count FROM public.site_users")) return { rows: [{ count: 12 }], rowCount: 1 };
    if (text.includes("COUNT(*)::int AS count FROM public.orders")) return { rows: [{ count: 4 }], rowCount: 1 };
    if (text.includes("FROM public.orders") && text.includes("LIMIT 500")) return { rows: paidOrders, rowCount: paidOrders.length };
    if (text.includes("COUNT(*)::int AS count FROM public.shipments")) return { rows: [{ count: 2 }], rowCount: 1 };
    if (text.includes("FROM public.courses")) {
      return {
        rows: [
          { id: "book-1", type: "book", requires_shipping: true },
          { id: "course-1", type: "course", requires_shipping: false },
        ],
        rowCount: 2,
      };
    }
    if (text.includes("FROM public.shipments WHERE order_id")) return { rows: [], rowCount: 0 };
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await getAdminOverview(
    makeRequest("/api/functions/admin-overview", { token: "admin-token" })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.stats, {
    revenue_rial: 350,
    paid_orders: 4,
    users: 12,
    pending_shipments: 3,
    missing_shipments: 1,
  });
  assert.deepEqual(body.gateway, {
    sandbox: false,
    mode: "production",
    merchant_configured: true,
    merchant_masked: "12345678…9abc",
    callback_url: "https://www.example.test/payment-result",
    price_to_rial_factor: 10,
    problems: [],
  });
  assert.ok(queries.length >= 8);
});

test("POST /api/functions/admin-upload-url issues a scoped short-lived local upload token to a PostgreSQL admin", async () => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
  process.env.STORAGE_SIGNING_SECRET = "x".repeat(64);
  const queries = [];
  installPostgresPoolForTests({
    async query(text, values = []) {
      queries.push({ text, values });
      if (text.includes("FROM public.user_sessions")) {
        return { rows: [{ id: "session-1", user_id: "admin-1", expired: false }], rowCount: 1 };
      }
      if (text.includes("FROM public.site_users")) {
        return { rows: [{ id: "admin-1", role: "admin" }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  });

  const response = await getAdminUploadUrl(
    makeRequest("/api/functions/admin-upload-url", {
      token: "admin-session-token",
      kind: "image",
      filename: "Cover Photo.JPG",
      content_type: "image/jpeg",
    })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.match(body.path, /^courses\/[0-9a-f-]+-cover-photo.jpg$/);
  assert.equal(body.upload_url, "/api/storage/upload");
  assert.equal(body.public_url, `/storage/course-images/${body.path}`);
  assert.equal(typeof body.upload_token, "string");
  const claims = verifyStorageToken(body.upload_token, "upload");
  assert.deepEqual(
    { bucket: claims.bucket, path: claims.path, maxBytes: claims.maxBytes, overwrite: claims.overwrite },
    { bucket: "course-images", path: body.path, maxBytes: 10 * 1024 * 1024, overwrite: false }
  );
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0].values, [hashSessionToken("admin-session-token")]);
  assert.deepEqual(queries[1].values, ["admin-1"]);
});

test("POST /api/functions/site-content saves sanitized content with PostgreSQL admin attribution", async () => {
  setTestEnv();
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
  const queries = mockPostgres(async (text) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text.trim())) return { rows: [], rowCount: 0 };
    if (text.includes("FROM public.user_sessions")) {
      return { rows: [{ id: "session-1", user_id: "admin-1", expired: false }], rowCount: 1 };
    }
    if (text.includes("FROM public.site_users")) {
      return { rows: [{ id: "admin-1", role: "admin" }], rowCount: 1 };
    }
    if (text.includes("INSERT INTO public.site_content")) return { rows: [], rowCount: 2 };
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await updateSiteContent(makeRequest("/api/functions/site-content", {
    token: "admin-token",
    action: "set",
    items: {
      "home.title": "عنوان تازه",
      "bad key": "ignored",
      "course.description": "x".repeat(8005),
    },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, saved: 2 });
  const upsert = queries.find((query) => query.text.includes("INSERT INTO public.site_content"));
  assert.match(upsert.text, /ON CONFLICT \(key\) DO UPDATE/);
  assert.deepEqual(upsert.values, ["home.title", "عنوان تازه", "admin-1", "course.description", "x".repeat(8000), "admin-1"]);
  assert.deepEqual(queries[0].values, [hashSessionToken("admin-token")]);
});

test("POST /api/functions/site-content resets only valid keys for an active PostgreSQL admin", async () => {
  setTestEnv();
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
  const queries = mockPostgres(async (text) => {
    if (text.includes("FROM public.user_sessions")) {
      return { rows: [{ id: "session-1", user_id: "admin-1", expired: false }], rowCount: 1 };
    }
    if (text.includes("FROM public.site_users")) {
      return { rows: [{ id: "admin-1", role: "admin" }], rowCount: 1 };
    }
    if (text.includes("DELETE FROM public.site_content")) return { rows: [], rowCount: 2 };
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await updateSiteContent(makeRequest("/api/functions/site-content", {
    token: "admin-token",
    action: "reset",
    keys: ["home.title", "not valid", "course.description"],
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, removed: 2 });
  const deletion = queries.find((query) => query.text.includes("DELETE FROM public.site_content"));
  assert.match(deletion.text, /key = ANY\(\$1::text\[\]\)/);
  assert.deepEqual(deletion.values, [["home.title", "course.description"]]);
});
