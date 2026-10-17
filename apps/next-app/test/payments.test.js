import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { POST as paymentRequest } from "../app/api/functions/payment-request/route.js";
import { POST as paymentVerify } from "../app/api/functions/payment-verify/route.js";
import {
  installPostgresPoolForTests,
  resetPostgresPoolForTests,
} from "../lib/postgres.js";

const envKeys = [
  "DATABASE_URL", "NODE_ENV", "ZARINPAL_MERCHANT_ID", "ZARINPAL_SANDBOX",
  "ZARINPAL_CALLBACK_URL", "PRICE_TO_RIAL_FACTOR",
];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const TOKEN = "payment-session-token";
const session = { id: "session-1", user_id: "user-1" };
const user = { id: "user-1", phone: "989121111111", first_name: "علی", last_name: "رضایی" };

function setTestEnv(extra = {}) {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
  process.env.NODE_ENV = "test";
  process.env.ZARINPAL_MERCHANT_ID = "12345678-1234-1234-1234-123456789abc";
  process.env.ZARINPAL_SANDBOX = "false";
  process.env.ZARINPAL_CALLBACK_URL = "https://www.example.test/payment-result";
  process.env.PRICE_TO_RIAL_FACTOR = "10";
  Object.assign(process.env, extra);
}

function makeRequest(body) {
  return new Request("http://localhost/api/functions/payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createDb(overrides = {}) {
  return {
    course: {
      id: "book-1", title: "کتاب تست", type: "book", price: 10000,
      discount_price: null, requires_shipping: true,
    },
    paidOrders: [],
    cartRows: [],
    address: {
      user_id: "user-1", full_name: "علی رضایی", phone: "09121111111", province: "تهران",
      city: "تهران", address: "خیابان آزادی", postal_code: "1234567890",
    },
    orders: [],
    shipments: [],
    ...overrides,
  };
}

function installPostgres(db, { gateway } = {}) {
  const queries = [];
  const gatewayRequests = [];
  const runQuery = async (text, values = []) => {
    queries.push({ text, values });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text.trim())) return { rows: [], rowCount: 0 };
    if (text.includes("FROM public.user_sessions")) {
      return { rows: [{ ...session, expired: false }], rowCount: 1 };
    }
    if (text.includes("FROM public.site_users") && /SELECT\s+id,\s*phone/i.test(text)) {
      return { rows: [user], rowCount: 1 };
    }
    if (text.startsWith("SELECT course_ids")) {
      return { rows: db.paidOrders, rowCount: db.paidOrders.length };
    }
    if (text.startsWith("SELECT * FROM public.orders WHERE authority")) {
      const order = db.orders.find((candidate) => candidate.authority === values[0]);
      return { rows: order ? [order] : [], rowCount: order ? 1 : 0 };
    }
    if (text.startsWith("SELECT * FROM public.orders WHERE id = $1 FOR UPDATE")) {
      const order = db.orders.find((candidate) => candidate.id === values[0]);
      return { rows: order ? [order] : [], rowCount: order ? 1 : 0 };
    }
    if (text.startsWith("INSERT INTO public.orders")) {
      const order = {
        id: `order-${db.orders.length + 1}`,
        user_id: values[0],
        amount_rial: values[1],
        description: values[2],
        status: "init",
        source: values[3],
        items: JSON.parse(values[4]),
        course_ids: values[5],
        authority: null,
        ref_id: null,
        card_pan: null,
      };
      db.orders.push(order);
      return { rows: [{ id: order.id }], rowCount: 1 };
    }
    if (text.startsWith("UPDATE public.orders")) {
      let order;
      if (text.includes("status = 'paid'")) {
        order = db.orders.find((candidate) => candidate.id === values[2]);
        if (order?.status === "pending") {
          Object.assign(order, {
            status: "paid", ref_id: values[0], card_pan: values[1],
            verified_at: "2026-10-17T00:00:00.000Z",
          });
          return { rows: [order], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("authority = $1")) {
        order = db.orders.find((candidate) => candidate.id === values[1]);
        if (order?.status === "init") Object.assign(order, { status: "pending", authority: values[0] });
        return { rows: order?.status === "pending" ? [{ id: order.id }] : [], rowCount: order?.status === "pending" ? 1 : 0 };
      }
      if (text.includes("status = 'failed'")) {
        order = db.orders.find((candidate) => candidate.id === values[0]);
        if (order?.status === "pending" || order?.status === "init") order.status = "failed";
        return { rows: [], rowCount: order ? 1 : 0 };
      }
      throw new Error(`Unexpected order update: ${text}`);
    }
    if (text.includes("FROM public.courses")) {
      if (text.includes("WHERE id = $1")) {
        const course = String(db.course?.id) === String(values[0]) ? db.course : null;
        return { rows: course ? [course] : [], rowCount: course ? 1 : 0 };
      }
      const courses = db.courses ?? (db.course ? [db.course] : []);
      return { rows: courses, rowCount: courses.length };
    }
    if (text.includes("INNER JOIN public.courses")) {
      const courses = db.cartRows.map((row) => {
        const found = (db.courses ?? [db.course]).find((item) => String(item.id) === String(row.course_id));
        return found;
      }).filter(Boolean);
      return { rows: courses, rowCount: courses.length };
    }
    if (text.startsWith("SELECT user_id FROM public.user_addresses")) {
      const address = db.address && String(db.address.user_id) === String(values[0]) ? db.address : null;
      return { rows: address ? [{ user_id: address.user_id }] : [], rowCount: address ? 1 : 0 };
    }
    if (text.startsWith("SELECT full_name, phone, province, city, address, postal_code FROM public.user_addresses")) {
      const address = db.address && String(db.address.user_id) === String(values[0]) ? db.address : null;
      return { rows: address ? [address] : [], rowCount: address ? 1 : 0 };
    }
    if (text.startsWith("DELETE FROM public.cart_items")) {
      const [userId, courseIds] = values;
      db.cartRows = db.cartRows.filter((row) =>
        String(row.user_id) !== String(userId) || !courseIds.includes(String(row.course_id))
      );
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("SELECT id, status FROM public.shipments")) {
      const shipment = db.shipments.find((item) => String(item.order_id) === String(values[0]));
      return { rows: shipment ? [{ id: shipment.id, status: shipment.status }] : [], rowCount: shipment ? 1 : 0 };
    }
    if (text.startsWith("INSERT INTO public.shipments")) {
      const shipment = {
        id: `shipment-${db.shipments.length + 1}`,
        order_id: values[0], user_id: values[1], full_name: values[2], phone: values[3],
        province: values[4], city: values[5], address: values[6], postal_code: values[7],
        status: "pending", tracking_code: null,
      };
      db.shipments.push(shipment);
      return { rows: [{ id: shipment.id }], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  };

  installPostgresPoolForTests({
    query: runQuery,
    async connect() {
      return { query: runQuery, release() {} };
    },
  });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const request = { url, method: init.method ?? "GET", init, body: init.body ? JSON.parse(init.body) : null };
    gatewayRequests.push(request);
    if (url.hostname !== "payment.zarinpal.com" && url.hostname !== "sandbox.zarinpal.com") {
      throw new Error(`Unexpected external request: ${url}`);
    }
    const responseBody = typeof gateway === "function"
      ? gateway(request)
      : url.pathname.includes("verify.json")
        ? { data: { code: 100, ref_id: 987654321, card_pan: "6037****1234" } }
        : { data: { code: 100, authority: "A-TEST" } };
    return Response.json(responseBody);
  };
  return { queries, gatewayRequests };
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

test("payment-request validates shipping address, uses database prices, and creates a pending Zarinpal order", async () => {
  setTestEnv();
  const db = createDb({ address: null });
  const { gatewayRequests } = installPostgres(db);

  const needsAddress = await paymentRequest(makeRequest({ token: TOKEN, course_id: "book-1", address_confirmed: true }));
  assert.equal(needsAddress.status, 400);
  assert.equal((await needsAddress.json()).needs_address, true);
  assert.equal(db.orders.length, 0);

  db.address = createDb().address;
  const response = await paymentRequest(makeRequest({ token: TOKEN, course_id: "book-1", address_confirmed: true }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.pay_url, "https://payment.zarinpal.com/pg/StartPay/A-TEST");
  assert.equal(body.needs_shipping, true);

  const order = db.orders[0];
  assert.equal(order.status, "pending");
  assert.equal(order.source, "direct");
  assert.equal(order.amount_rial, 100000);
  assert.deepEqual(order.course_ids, ["book-1"]);
  assert.equal(order.items[0].requires_shipping, true);
  const gatewayRequest = gatewayRequests.find((request) => request.url.hostname === "payment.zarinpal.com");
  assert.equal(gatewayRequest.body.amount, 100000);
  assert.equal(gatewayRequest.body.callback_url, "https://www.example.test/payment-result");
  assert.equal(gatewayRequest.body.metadata.mobile, "09121111111");
  assert.equal(gatewayRequest.body.metadata.order_id, order.id);
});

test("payment-request uses sandbox configuration and refuses an invalid merchant", async () => {
  setTestEnv({ ZARINPAL_SANDBOX: "true" });
  const db = createDb({ course: { id: "course-1", title: "دوره", type: "course", price: 2000 } });
  const { gatewayRequests } = installPostgres(db);
  const response = await paymentRequest(makeRequest({ token: TOKEN, course_id: "course-1" }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.sandbox, true);
  assert.equal(body.pay_url, "https://sandbox.zarinpal.com/pg/StartPay/A-TEST");
  assert.equal(gatewayRequests.find((request) => request.url.hostname === "sandbox.zarinpal.com").body.amount, 20000);

  process.env.ZARINPAL_MERCHANT_ID = "invalid-merchant";
  const invalid = await paymentRequest(makeRequest({ token: TOKEN, course_id: "course-1" }));
  assert.equal(invalid.status, 500);
  assert.equal((await invalid.json()).gateway_configured, false);
});

test("payment-verify confirms a physical cart order, clears its cart, creates a shipment, and is idempotent", async () => {
  setTestEnv();
  const order = {
    id: "order-1", user_id: "user-1", status: "pending", authority: "S-AUTH-1", amount_rial: 100000,
    source: "cart", course_ids: ["book-1"],
    items: [{ course_id: "book-1", title: "کتاب تست", type: "book", unit_price_rial: 100000, requires_shipping: true }],
  };
  const db = createDb({
    orders: [order],
    cartRows: [{ id: "cart-1", user_id: "user-1", course_id: "book-1" }],
  });
  const { gatewayRequests } = installPostgres(db);

  const response = await paymentVerify(makeRequest({ authority: "S-AUTH-1" }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.ref_id, 987654321);
  assert.equal(body.needs_shipping, true);
  assert.equal(body.shipment_created, true);
  assert.equal(order.status, "paid");
  assert.equal(order.card_pan, "6037****1234");
  assert.equal(db.cartRows.length, 0);
  assert.equal(db.shipments.length, 1);
  assert.equal(db.shipments[0].order_id, "order-1");
  assert.equal(db.shipments[0].postal_code, "1234567890");
  assert.equal(db.shipments[0].status, "pending");
  assert.equal(gatewayRequests.find((request) => request.url.pathname.includes("verify.json")).url.hostname, "sandbox.zarinpal.com");

  const verifyCallsBeforeRepeat = gatewayRequests.filter((request) => request.url.pathname.includes("verify.json")).length;
  const again = await paymentVerify(makeRequest({ authority: "S-AUTH-1" }));
  const againBody = await again.json();
  assert.equal(againBody.already, true);
  assert.equal(db.shipments.length, 1);
  assert.equal(gatewayRequests.filter((request) => request.url.pathname.includes("verify.json")).length, verifyCallsBeforeRepeat);
});

test("payment-verify marks a failed transaction failed and does not grant access", async () => {
  setTestEnv();
  const order = {
    id: "order-failed", user_id: "user-1", status: "pending", authority: "A-FAIL", amount_rial: 20000,
    source: "direct", course_ids: ["course-1"], items: [{ course_id: "course-1", type: "course", requires_shipping: false }],
  };
  const db = createDb({ orders: [order] });
  installPostgres(db, { gateway: () => ({ errors: { code: -51, message: "failed" } }) });

  const response = await paymentVerify(makeRequest({ authority: "A-FAIL" }));
  assert.equal(response.status, 402);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.code, -51);
  assert.equal(order.status, "failed");
  assert.equal(db.shipments.length, 0);
});
