import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { POST as addToCart } from "../app/api/functions/add-to-cart/route.js";
import { POST as getCart } from "../app/api/functions/get-cart/route.js";
import { POST as removeFromCart } from "../app/api/functions/remove-from-cart/route.js";
import { POST as getMyAddress } from "../app/api/functions/get-my-address/route.js";
import { POST as saveShippingAddress } from "../app/api/functions/save-shipping-address/route.js";
import { POST as getMyCourses } from "../app/api/functions/get-my-courses/route.js";
import { POST as checkCourseAccess } from "../app/api/functions/check-course-access/route.js";
import {
  installPostgresPoolForTests,
  resetPostgresPoolForTests,
} from "../lib/postgres.js";
import { hashSessionToken } from "../lib/session-token.js";

const envKeys = ["DATABASE_URL", "NODE_ENV"];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

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
const address = {
  full_name: "سارا رضایی",
  phone: "09123456789",
  province: "تهران",
  city: "تهران",
  address: "خیابان آزادی",
  postal_code: "1234567890",
  updated_at: "2026-01-01T00:00:00.000Z",
};

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

function mockPostgres(respond) {
  const queries = [];
  const runQuery = async (text, values = []) => {
    queries.push({ text, values });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text.trim())) return { rows: [], rowCount: 0 };
    if (text.includes("FROM public.user_sessions")) {
      return {
        rows: [{ id: "session-1", user_id: "user-1", expired: false }],
        rowCount: 1,
      };
    }
    if (text.includes("FROM public.site_users")) return { rows: [user], rowCount: 1 };
    return respond(text, values, queries);
  };
  installPostgresPoolForTests({
    query: runQuery,
    async connect() {
      return { query: runQuery, release() {} };
    },
  });
  globalThis.fetch = async (input) => {
    throw new Error(`Unexpected external request: ${String(input)}`);
  };
  return queries;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  const currentNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  resetPostgresPoolForTests();
  if (currentNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = currentNodeEnv;
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

test("POST /api/functions/add-to-cart checks ownership and adds an unpurchased course", async () => {
  setTestEnv();
  const queries = mockPostgres(async (text) => {
    if (text.includes("FROM public.courses")) return { rows: [{ id: "course-1" }], rowCount: 1 };
    if (text.includes("AS purchased")) return { rows: [{ purchased: false }], rowCount: 1 };
    if (text.includes("INSERT INTO public.cart_items")) return { rows: [{ id: "cart-1" }], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await addToCart(
    makeRequest("/api/functions/add-to-cart", { token: "commerce-token", course_id: "course-1" })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, message: "added to cart" });
  const insert = queries.find((query) => query.text.includes("INSERT INTO public.cart_items"));
  assert.deepEqual(insert.values, ["user-1", "course-1"]);
  assert.deepEqual(queries[0].values, [hashSessionToken("commerce-token")]);
});

test("POST /api/functions/add-to-cart refuses paid or recorded purchases before insertion", async () => {
  setTestEnv();
  const queries = mockPostgres(async (text) => {
    if (text.includes("FROM public.courses")) return { rows: [{ id: "course-1" }], rowCount: 1 };
    if (text.includes("AS purchased")) return { rows: [{ purchased: true }], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await addToCart(
    makeRequest("/api/functions/add-to-cart", { token: "commerce-token", course_id: "course-1" })
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { success: false, error: "already purchased" });
  assert.equal(queries.some((query) => query.text.includes("INSERT INTO public.cart_items")), false);
});

test("POST /api/functions/add-to-cart treats concurrent duplicate inserts as already in cart", async () => {
  setTestEnv();
  mockPostgres(async (text) => {
    if (text.includes("FROM public.courses")) return { rows: [{ id: "course-1" }], rowCount: 1 };
    if (text.includes("AS purchased")) return { rows: [{ purchased: false }], rowCount: 1 };
    if (text.includes("INSERT INTO public.cart_items")) return { rows: [], rowCount: 0 };
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const response = await addToCart(
    makeRequest("/api/functions/add-to-cart", { token: "commerce-token", course_id: "course-1" })
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, message: "already in cart" });
});

test("POST /api/functions/get-cart preserves nested course rows and total calculations", async () => {
  setTestEnv();
  mockPostgres(async (text) => {
    if (text.includes("INNER JOIN public.courses")) {
      return {
        rows: [{
          cart_item_id: "cart-1",
          created_at: "2026-01-01T00:00:00.000Z",
          course_id: course.id,
          course_title: course.title,
          course_description: course.description,
          course_price: course.price,
          course_discount_price: course.discount_price,
          course_image_url: course.image_url,
          course_grade: course.grade,
          course_category: course.category,
          course_type: course.type,
          course_major: course.major,
        }],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await getCart(makeRequest("/api/functions/get-cart", { token: "commerce-token" }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.items, [{ id: "cart-1", created_at: "2026-01-01T00:00:00.000Z", courses: course }]);
  assert.equal(body.total_price, 150);
  assert.equal(body.total_discount, 50);
  assert.equal(body.count, 1);
});

test("POST /api/functions/remove-from-cart scopes deletion to the session owner", async () => {
  setTestEnv();
  const queries = mockPostgres(async (text, values) => {
    if (text.startsWith("DELETE FROM public.cart_items")) {
      assert.match(text, /WHERE id = \$1 AND user_id = \$2/);
      assert.deepEqual(values, ["cart-1", "user-1"]);
      return { rows: [{ id: "cart-1" }], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
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
  assert.ok(queries.some((query) => query.text.startsWith("DELETE FROM public.cart_items")));
});

test("shipping address routes convert Persian digits and save/retrieve the user's address", async () => {
  setTestEnv();
  const queries = mockPostgres(async (text, values) => {
    if (text.startsWith("INSERT INTO public.user_addresses")) {
      assert.match(text, /ON CONFLICT \(user_id\) DO UPDATE/);
      assert.deepEqual(values, ["user-1", "سارا رضایی", "09123456789", "تهران", "تهران", "خیابان آزادی", "1234567890"]);
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("SELECT full_name, phone, province")) return { rows: [address], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${text}`);
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

  const readResponse = await getMyAddress(
    makeRequest("/api/functions/get-my-address", { token: "commerce-token" })
  );
  assert.equal(readResponse.status, 200);
  assert.deepEqual(await readResponse.json(), { success: true, address });
  assert.ok(queries.some((query) => query.text.startsWith("INSERT INTO public.user_addresses")));
  assert.ok(queries.some((query) => query.text.startsWith("SELECT full_name, phone, province")));
});

test("POST /api/functions/get-my-courses returns unique paid courses in the legacy wrapper shape", async () => {
  setTestEnv();
  const course2 = { ...course, id: "course-2", title: "دوره‌ی دوم" };
  const queries = mockPostgres(async (text, values) => {
    if (text.includes("FROM public.orders")) {
      assert.deepEqual(values, ["user-1"]);
      return {
        rows: [
          { course_ids: ["course-1", "course-2"] },
          { course_ids: ["course-1"] },
        ],
        rowCount: 2,
      };
    }
    if (text.includes("FROM public.courses")) {
      assert.deepEqual(values, [["course-1", "course-2"]]);
      return { rows: [course2, course], rowCount: 2 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await getMyCourses(
    makeRequest("/api/functions/get-my-courses", { token: "commerce-token" })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.courses, [{ courses: course }, { courses: course2 }]);
  assert.ok(queries.some((query) => query.text.includes("status = 'paid'")));
});

test("POST /api/functions/check-course-access reports paid ownership from orders", async () => {
  setTestEnv();
  const queries = mockPostgres(async (text, values) => {
    if (text.includes("FROM public.courses")) {
      assert.deepEqual(values, ["course-1"]);
      return { rows: [course], rowCount: 1 };
    }
    if (text.includes("FROM public.orders")) {
      assert.deepEqual(values, ["user-1", "course-1"]);
      return { rows: [{ owned: 1 }], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
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
  assert.ok(queries.some((query) => query.text.includes("$2 = ANY(course_ids)")));
});
