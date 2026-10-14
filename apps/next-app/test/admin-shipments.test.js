import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { POST as adminShipments } from "../app/api/functions/admin-shipments/route.js";

const envKeys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const session = { id: "session-1", user_id: "admin-1", expires_at: "2099-01-01T00:00:00.000Z" };
const admin = { id: "admin-1", role: "admin" };

function setTestEnv() {
  process.env.SUPABASE_URL = "https://project.supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
}

function makeRequest(body) {
  return new Request("http://localhost/api/functions/admin-shipments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function isAdminSelect(url) {
  return url.searchParams.get("select")?.replace(/\s/g, "") === "id,role";
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

test("POST /api/functions/admin-shipments marks a shipment sent with a normalized tracking code", async () => {
  setTestEnv();
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const request = { url, method: init.method ?? "GET", init };
    requests.push(request);
    if (url.pathname.endsWith("/user_sessions")) return Response.json(session);
    if (url.pathname.endsWith("/site_users") && isAdminSelect(url)) return Response.json(admin);
    if (url.pathname.endsWith("/shipments") && request.method === "PATCH") return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${request.method} ${url}`);
  };

  const response = await adminShipments(
    makeRequest({ token: "admin-token", action: "mark_sent", shipment_id: "shipment-1", tracking_code: " 12345 " })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  const update = requests.find((request) => request.method === "PATCH");
  const updatedShipment = JSON.parse(update.init.body);
  assert.equal(updatedShipment.status, "sent");
  assert.equal(updatedShipment.tracking_code, "12345");
  assert.ok(Number.isFinite(Date.parse(updatedShipment.sent_at)));
  assert.ok(Number.isFinite(Date.parse(updatedShipment.updated_at)));
  assert.equal(updatedShipment.sent_at, updatedShipment.updated_at);
  assert.equal(update.url.searchParams.get("id"), "eq.shipment-1");
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
    user_id: "user-with-address",
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
  const requests = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const request = { url, method: init.method ?? "GET", init, body: init.body ? JSON.parse(init.body) : null };
    requests.push(request);
    const table = url.pathname.split("/").at(-1);

    if (table === "user_sessions") return Response.json(session);
    if (table === "site_users" && isAdminSelect(url)) return Response.json(admin);
    if (table === "courses") return Response.json([{ id: "book-1", type: "book", requires_shipping: true }]);
    if (table === "orders") return Response.json(paidOrders);
    if (table === "user_addresses") {
      return url.searchParams.get("user_id") === "eq.user-with-address"
        ? Response.json(address)
        : Response.json(null);
    }
    if (table === "shipments" && request.method === "POST") {
      const inserted = { id: "shipment-1", ...request.body };
      shipments = [inserted, ...shipments];
      return Response.json({ id: inserted.id }, { status: 201 });
    }
    if (table === "shipments" && request.method === "GET" && url.searchParams.get("select") === "order_id") {
      return Response.json(shipments.map(({ order_id }) => ({ order_id })));
    }
    if (table === "shipments" && request.method === "GET") return Response.json(shipments);
    if (table === "site_users") return Response.json(users);
    throw new Error(`Unexpected request: ${request.method} ${url}`);
  };

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
  const insert = requests.find((request) => request.method === "POST" && request.url.pathname.endsWith("/shipments"));
  assert.equal(insert.body.status, "pending");
  assert.equal(insert.body.order_id, "order-book");
});
