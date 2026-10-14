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

const envKeys = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
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
  process.env.SUPABASE_URL = "https://project.supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
}

function makeRequest(path, body) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockAdmin(respond, { role = "admin" } = {}) {
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const request = { url, method: init.method ?? "GET", init };
    requests.push(request);

    if (url.pathname.endsWith("/user_sessions")) return Response.json(session);
    if (
      url.pathname.endsWith("/site_users") &&
      url.searchParams.get("select")?.replace(/\s/g, "") === "id,role" &&
      request.method === "GET"
    ) {
      return Response.json(role ? { ...admin, role } : null);
    }
    return respond(request);
  };
  return requests;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

test("admin API rejects non-admin sessions before reading privileged data", async () => {
  setTestEnv();
  const requests = mockAdmin(() => {
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
  mockAdmin((request) => {
    if (request.url.pathname.endsWith("/courses")) return Response.json(courses);
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
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
  mockAdmin((request) => {
    if (request.url.pathname.endsWith("/course_sessions")) return Response.json(sessions);
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
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
  mockAdmin((request) => {
    if (request.url.pathname.endsWith("/site_users")) return Response.json(users);
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
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
  const requests = mockAdmin((request) => {
    const path = request.url.pathname;
    if (path.endsWith("/orders")) return Response.json([order]);
    if (path.endsWith("/courses")) {
      return Response.json([{ id: "book-1", type: "book", requires_shipping: true }]);
    }
    if (path.endsWith("/shipments")) {
      return Response.json([{ order_id: "order-1", status: "sent", tracking_code: "TR-1" }]);
    }
    if (path.endsWith("/site_users")) return Response.json([customer]);
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
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
  assert.ok(requests.some((request) => request.url.pathname.endsWith("/shipments")));
});

test("POST /api/functions/admin-create-course stores normalized optional fields and returns the created course", async () => {
  setTestEnv();
  const course = { id: "course-new", title: "ریاضی", type: "course", price: 120 };
  const requests = mockAdmin((request) => {
    if (request.url.pathname.endsWith("/courses") && request.method === "POST") {
      return Response.json(course, { status: 201 });
    }
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
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
  const insert = requests.find((request) => request.url.pathname.endsWith("/courses") && request.method === "POST");
  assert.deepEqual(JSON.parse(insert.init.body), {
    title: "ریاضی",
    grade: "11",
    category: null,
    type: "course",
    description: null,
    price: 120,
    discount_price: null,
    image_url: null,
    major: null,
  });
});

test("POST /api/functions/admin-update-course only updates editable fields and converts empty values to null", async () => {
  setTestEnv();
  const requests = mockAdmin((request) => {
    if (request.url.pathname.endsWith("/courses") && request.method === "PATCH") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
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
  const update = requests.find((request) => request.method === "PATCH");
  assert.deepEqual(JSON.parse(update.init.body), { title: "جبر", major: null });
  assert.equal(update.url.searchParams.get("id"), "eq.course-1");
});

test("POST /api/functions/admin-save-sessions deletes removed rows and upserts the validated list", async () => {
  setTestEnv();
  const requests = mockAdmin((request) => {
    if (request.url.pathname.endsWith("/course_sessions") && request.method === "GET") {
      return Response.json([{ id: "session-1" }, { id: "session-deleted" }]);
    }
    if (request.url.pathname.endsWith("/course_sessions") && request.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    if (request.url.pathname.endsWith("/course_sessions") && request.method === "POST") {
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
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
  const deletion = requests.find((request) => request.method === "DELETE");
  assert.equal(deletion.url.searchParams.get("id"), "in.(session-deleted)");
  const upsert = requests.find((request) => request.method === "POST");
  assert.deepEqual(JSON.parse(upsert.init.body), [
    {
      id: "session-1",
      course_id: "course-1",
      session_number: 1,
      title: "مقدمه",
      video_url: null,
      is_online: true,
      online_url: "https://live.example/class",
      scheduled_at: null,
    },
    {
      course_id: "course-1",
      session_number: 2,
      title: "تمرین",
      video_url: "/video.mp4",
      is_online: false,
      online_url: null,
      scheduled_at: null,
    },
  ]);
});

test("POST /api/functions/admin-overview reports sales, shipping gaps, and mirrored gateway status", async () => {
  setTestEnv();
  process.env.ZARINPAL_MERCHANT_ID = "12345678-1234-1234-1234-123456789abc";
  process.env.ZARINPAL_SANDBOX = "false";
  process.env.ZARINPAL_CALLBACK_URL = "https://www.example.test/payment-result";
  process.env.PRICE_TO_RIAL_FACTOR = "10";
  const paidOrders = [
    { id: "order-book", amount_rial: 150, items: [{ course_id: "book-1" }], course_ids: ["book-1"] },
    { id: "order-course", amount_rial: 200, items: [{ course_id: "course-1" }], course_ids: ["course-1"] },
  ];
  const requests = mockAdmin((request) => {
    const path = request.url.pathname;
    if (request.method === "HEAD" && path.endsWith("/site_users")) {
      return new Response(null, { status: 200, headers: { "content-range": "0-0/12" } });
    }
    if (request.method === "HEAD" && path.endsWith("/orders")) {
      return new Response(null, { status: 200, headers: { "content-range": "0-0/4" } });
    }
    if (request.method === "HEAD" && path.endsWith("/shipments")) {
      return new Response(null, { status: 200, headers: { "content-range": "0-0/2" } });
    }
    if (path.endsWith("/orders")) return Response.json(paidOrders);
    if (path.endsWith("/courses")) {
      return Response.json([
        { id: "book-1", type: "book", requires_shipping: true },
        { id: "course-1", type: "course", requires_shipping: false },
      ]);
    }
    if (path.endsWith("/shipments")) return Response.json([]);
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
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
  assert.ok(requests.length >= 8);
});

test("POST /api/functions/admin-upload-url signs an image upload and returns its public URL", async () => {
  setTestEnv();
  const requests = mockAdmin((request) => {
    if (request.url.pathname.includes("/storage/v1/object/upload/sign/")) {
      return Response.json({
        url: `${request.url.pathname.replace("/storage/v1", "")}?token=signed-upload-token`,
      });
    }
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  const response = await getAdminUploadUrl(
    makeRequest("/api/functions/admin-upload-url", {
      token: "admin-token",
      kind: "image",
      filename: "Cover Photo.JPG",
    })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.match(body.path, /^courses\/\d+-cover-photo.jpg$/);
  assert.equal(body.upload_url, `https://project.supabase.test/storage/v1/object/upload/sign/course-images/${body.path}?token=signed-upload-token`);
  assert.equal(body.public_url, `https://project.supabase.test/storage/v1/object/public/course-images/${body.path}`);
  const storageRequest = requests.find((request) => request.url.pathname.includes("/storage/v1/object/upload/sign/"));
  assert.equal(storageRequest.method, "POST");
});
