import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { POST as adminShipments } from "../app/api/functions/admin-shipments/route.js";
import {
  installPostgresPoolForTests,
  resetPostgresPoolForTests,
} from "../lib/postgres.js";

const envKeys = ["DATABASE_URL", "NODE_ENV"];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const session = { id: "session-1", user_id: "admin-1" };
const admin = { id: "admin-1", role: "admin" };

function setTestEnv() {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
  process.env.NODE_ENV = "test";
}

function makeRequest(body) {
  return new Request("http://localhost/api/functions/admin-shipments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockPostgres(respond) {
  const queries = [];
  const runQuery = async (text, values = []) => {
    queries.push({ text, values });
    if (text.includes("FROM public.user_sessions")) {
      return { rows: [{ ...session, expired: false }], rowCount: 1 };
    }
    if (text.includes("FROM public.site_users") && /SELECT\s+id,\s*role/i.test(text)) {
      return { rows: [admin], rowCount: 1 };
    }
    return respond(text, values, queries);
  };
  installPostgresPoolForTests({ query: runQuery });
  return queries;
}

afterEach(() => {
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

test("POST /api/functions/admin-shipments marks a shipment sent with a normalized tracking code", async () => {
  setTestEnv();
  const queries = mockPostgres(async (text, values) => {
    if (text.includes("UPDATE public.shipments")) {
      assert.match(text, /status = 'sent'/);
      assert.match(text, /sent_at = NOW\(\)/);
      assert.deepEqual(values, ["12345", "shipment-1"]);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await adminShipments(
    makeRequest({ token: "admin-token", action: "mark_sent", shipment_id: "shipment-1", tracking_code: " 12345 " })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.ok(queries.some((query) => query.text.includes("UPDATE public.shipments")));
});

test("POST /api/functions/admin-shipments self-heals paid physical orders and reports missing addresses", async () => {
  setTestEnv();
  const paidOrders = [
    {
      id: "order-book",
      user_id: "user-with-address",
      amount_rial: 1000,
      ref_id: 123,
      status: "paid",
      source: "zarinpal",
      items: [{ course_id: "book-1", title: "کتاب تست" }],
      course_ids: ["book-1"],
      created_at: "2026-10-14T10:00:00.000Z",
    },
    {
      id: "order-missing-address",
      user_id: "user-no-address",
      amount_rial: 2000,
      ref_id: 456,
      status: "paid",
      source: "zarinpal",
      items: [{ course_id: "book-1", title: "جزوه فیزیک" }],
      course_ids: ["book-1"],
      created_at: "2026-10-13T10:00:00.000Z",
    },
  ];
  const address = {
    full_name: "علی رضایی",
    phone: "09120000000",
    province: "تهران",
    city: "تهران",
    address: "خیابان آزادی",
    postal_code: "1234567890",
  };
  const users = [
    { id: "user-with-address", first_name: "علی", last_name: "رضایی", phone: "09120000000" },
    { id: "user-no-address", first_name: "سارا", last_name: "محمدی", phone: "09121111111" },
  ];
  let shipments = [];
  let insertedShipmentValues;
  const queries = mockPostgres(async (text, values) => {
    if (text.includes("FROM public.courses")) {
      return { rows: [{ id: "book-1", type: "book", requires_shipping: true }], rowCount: 1 };
    }
    if (text.includes("FROM public.orders")) return { rows: paidOrders, rowCount: paidOrders.length };
    if (text.includes("SELECT order_id FROM public.shipments")) {
      return { rows: shipments.map(({ order_id }) => ({ order_id })), rowCount: shipments.length };
    }
    if (text.includes("FROM public.user_addresses")) {
      return values[0] === "user-with-address" ? { rows: [address], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (text.startsWith("INSERT INTO public.shipments")) {
      insertedShipmentValues = values;
      const inserted = {
        id: "shipment-1",
        order_id: values[0],
        user_id: values[1],
        full_name: values[2],
        phone: values[3],
        province: values[4],
        city: values[5],
        address: values[6],
        postal_code: values[7],
        status: "pending",
        created_at: "2026-10-14T11:00:00.000Z",
        updated_at: "2026-10-14T11:00:00.000Z",
        sent_at: null,
        tracking_code: null,
      };
      shipments = [inserted, ...shipments];
      return { rows: [{ id: inserted.id }], rowCount: 1 };
    }
    if (text.includes("SELECT * FROM public.shipments")) return { rows: shipments, rowCount: shipments.length };
    if (text.includes("FROM public.site_users") && text.includes("first_name")) return { rows: users, rowCount: users.length };
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await adminShipments(makeRequest({ token: "admin-token", action: "list" }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.sync.created, 1);
  assert.equal(body.sync.missing_address, 1);
  assert.equal(body.sync.needs_shipping, 2);
  assert.equal(body.shipments.length, 1);
  assert.equal(body.shipments[0].order_id, "order-book");
  assert.deepEqual(body.shipments[0].items, ["کتاب تست"]);
  assert.equal(body.missing_shipments.length, 1);
  assert.equal(body.missing_shipments[0].order_id, "order-missing-address");
  assert.equal(body.missing_shipments[0].phone, "09121111111");
  assert.equal(body.missing_shipments[0].no_shipment, true);
  assert.deepEqual(insertedShipmentValues, [
    "order-book", "user-with-address", "علی رضایی", "09120000000", "تهران", "تهران", "خیابان آزادی", "1234567890",
  ]);
  assert.ok(queries.some((query) => query.text.includes("ON CONFLICT (order_id) DO NOTHING")));
});
