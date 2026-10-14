import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { POST as addToCart } from "../app/api/functions/add-to-cart/route.js";
import { POST as getCart } from "../app/api/functions/get-cart/route.js";
import { POST as removeFromCart } from "../app/api/functions/remove-from-cart/route.js";
import { POST as getMyAddress } from "../app/api/functions/get-my-address/route.js";
import { POST as saveShippingAddress } from "../app/api/functions/save-shipping-address/route.js";
import { POST as getMyCourses } from "../app/api/functions/get-my-courses/route.js";
import { POST as checkCourseAccess } from "../app/api/functions/check-course-access/route.js";

const envKeys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

const session = {
  id: "session-1",
  user_id: "user-1",
  expires_at: "2099-01-01T00:00:00.000Z",
};
const user = { id: "user-1", phone: "989120000000", first_name: "سارا", last_name: "رضایی" };
const course = {
  id: "course-1",
  title: "دوره‌ی آزمایشی",
  description: "توضیح دوره",
  price: 200,
  discount_price: 150,
  image_url: "/course.jpg",
  grade: "11",
  category: "math",
  type: "course",
  major: "ریاضی",
};

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

function mockCommerce(respond) {
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const request = {
      url,
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(init.body) : null,
      init,
    };
    requests.push(request);

    if (url.pathname.endsWith("/user_sessions") && request.method === "GET") {
      return Response.json(session);
    }
    if (url.pathname.endsWith("/site_users") && request.method === "GET") {
      return Response.json(user);
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

test("POST /api/functions/add-to-cart checks ownership and adds an unpurchased course", async () => {
  setTestEnv();
  const requests = mockCommerce((request) => {
    if (request.url.pathname.endsWith("/courses") && request.method === "GET") {
      return Response.json({ id: "course-1" });
    }
    if (request.url.pathname.endsWith("/user_purchases")) return Response.json(null);
    if (request.url.pathname.endsWith("/cart_items") && request.method === "GET") {
      return Response.json(null);
    }
    if (request.url.pathname.endsWith("/cart_items") && request.method === "POST") {
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  const response = await addToCart(
    makeRequest("/api/functions/add-to-cart", { token: "commerce-token", course_id: "course-1" })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, message: "added to cart" });
  const insert = requests.find((request) => request.url.pathname.endsWith("/cart_items") && request.method === "POST");
  assert.deepEqual(insert.body, { user_id: "user-1", course_id: "course-1" });
  assert.equal(requests[0].url.searchParams.get("token_hash")?.length, 67);
});

test("POST /api/functions/add-to-cart refuses a course already purchased", async () => {
  setTestEnv();
  const requests = mockCommerce((request) => {
    if (request.url.pathname.endsWith("/courses")) return Response.json({ id: "course-1" });
    if (request.url.pathname.endsWith("/user_purchases")) return Response.json({ id: "purchase-1" });
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  const response = await addToCart(
    makeRequest("/api/functions/add-to-cart", { token: "commerce-token", course_id: "course-1" })
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { success: false, error: "already purchased" });
  assert.equal(requests.some((request) => request.url.pathname.endsWith("/cart_items")), false);
});

test("POST /api/functions/get-cart preserves nested course rows and total calculations", async () => {
  setTestEnv();
  mockCommerce((request) => {
    if (request.url.pathname.endsWith("/cart_items")) {
      return Response.json([{ id: "cart-1", created_at: "2026-01-01T00:00:00Z", courses: course }]);
    }
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  const response = await getCart(makeRequest("/api/functions/get-cart", { token: "commerce-token" }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.items[0].courses.id, "course-1");
  assert.equal(body.total_price, 150);
  assert.equal(body.total_discount, 50);
  assert.equal(body.count, 1);
});

test("POST /api/functions/remove-from-cart scopes deletion to the session owner", async () => {
  setTestEnv();
  const requests = mockCommerce((request) => {
    if (request.url.pathname.endsWith("/cart_items") && request.method === "DELETE") {
      return Response.json([{ id: "cart-1" }]);
    }
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  const response = await removeFromCart(
    makeRequest("/api/functions/remove-from-cart", {
      token: "commerce-token",
      cart_item_id: "cart-1",
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    message: "removed from cart",
    deleted: [{ id: "cart-1" }],
  });
  const deletion = requests.find((request) => request.method === "DELETE");
  assert.equal(deletion.url.searchParams.get("id"), "eq.cart-1");
  assert.equal(deletion.url.searchParams.get("user_id"), "eq.user-1");
});

test("shipping address routes convert Persian digits and save/retrieve the user's address", async () => {
  setTestEnv();
  const address = {
    full_name: "سارا رضایی",
    phone: "09123456789",
    province: "تهران",
    city: "تهران",
    address: "خیابان آزادی",
    postal_code: "1234567890",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  const requests = mockCommerce((request) => {
    if (request.url.pathname.endsWith("/user_addresses") && request.method === "GET") {
      return request.url.searchParams.get("select") === "user_id"
        ? Response.json({ user_id: "user-1" })
        : Response.json(address);
    }
    if (request.url.pathname.endsWith("/user_addresses") && request.method === "PATCH") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  const saveResponse = await saveShippingAddress(
    makeRequest("/api/functions/save-shipping-address", {
      token: "commerce-token",
      full_name: " سارا رضایی ",
      phone: "۰۹۱۲۳۴۵۶۷۸۹",
      province: "تهران",
      city: "تهران",
      address: "خیابان آزادی",
      postal_code: "۱۲۳۴۵۶۷۸۹۰",
    })
  );
  assert.equal(saveResponse.status, 200);
  assert.deepEqual(await saveResponse.json(), { success: true });
  const update = requests.find((request) => request.url.pathname.endsWith("/user_addresses") && request.method === "PATCH");
  assert.equal(update.body.phone, "09123456789");
  assert.equal(update.body.postal_code, "1234567890");
  assert.equal(update.body.user_id, "user-1");

  const readResponse = await getMyAddress(
    makeRequest("/api/functions/get-my-address", { token: "commerce-token" })
  );
  assert.equal(readResponse.status, 200);
  assert.deepEqual(await readResponse.json(), { success: true, address });
});

test("POST /api/functions/get-my-courses returns unique paid courses in the legacy wrapper shape", async () => {
  setTestEnv();
  const course2 = { ...course, id: "course-2", title: "دوره‌ی دوم" };
  const requests = mockCommerce((request) => {
    if (request.url.pathname.endsWith("/orders")) {
      return Response.json([
        { course_ids: ["course-1", "course-2"] },
        { course_ids: ["course-1"] },
      ]);
    }
    if (request.url.pathname.endsWith("/courses")) return Response.json([course, course2]);
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  const response = await getMyCourses(
    makeRequest("/api/functions/get-my-courses", { token: "commerce-token" })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.courses, [{ courses: course }, { courses: course2 }]);
  const courseQuery = requests.find((request) => request.url.pathname.endsWith("/courses"));
  assert.equal(courseQuery.url.searchParams.get("id"), "in.(course-1,course-2)");
});

test("POST /api/functions/check-course-access reports paid ownership from orders", async () => {
  setTestEnv();
  const requests = mockCommerce((request) => {
    if (request.url.pathname.endsWith("/courses")) return Response.json(course);
    if (request.url.pathname.endsWith("/orders")) return Response.json([{ id: "order-1" }]);
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  const response = await checkCourseAccess(
    makeRequest("/api/functions/check-course-access", {
      token: "commerce-token",
      course_id: "course-1",
    })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.purchased, true);
  assert.deepEqual(body.course, course);
  const orderQuery = requests.find((request) => request.url.pathname.endsWith("/orders"));
  assert.equal(orderQuery.url.searchParams.get("course_ids"), "ov.{course-1}");
});
