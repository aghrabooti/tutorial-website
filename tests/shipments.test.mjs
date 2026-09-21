// End-to-end test of the shipment backfill logic with a mock database.
import { DB, LOG } from "./supabase-stub.js";
import "./.build/admin-shipments.mjs";

// ---- seed the fake database the way the live one looks ----
const TOKEN = "plain-token-123";
const tokenHash = Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN)))
).map((b) => b.toString(16).padStart(2, "0")).join("");

DB.site_users = [
  { id: "admin1", role: "admin", first_name: "مهدی", last_name: "عزیزی", phone: "09120000000" },
  { id: "user1", role: "user", first_name: "علی", last_name: "رضایی", phone: "09121111111" },
  { id: "user2", role: "user", first_name: "سارا", last_name: "محمدی", phone: "09122222222" },
];

DB.user_sessions = [
  { id: "sess1", user_id: "admin1", token_hash: tokenHash, is_active: true, expires_at: "2030-01-01T00:00:00Z" },
];

DB.courses = [
  { id: "c-book", title: "کتاب تست 1", type: "book", price: 10000, requires_shipping: true },
  { id: "c-lect", title: "جزوه فیزیک", type: "lecture", price: 5000, requires_shipping: false },
  { id: "c-course", title: "دوره ریاضی", type: "course", price: 202, requires_shipping: false },
];

DB.user_addresses = [
  { user_id: "user1", full_name: "علی رضایی", phone: "09121111111", province: "تهران", city: "تهران", address: "خیابان آزادی", postal_code: "1234567890" },
  // user2 has NO address on purpose
];

DB.orders = [
  {
    id: "o1", user_id: "user1", status: "paid", amount_rial: 100000, ref_id: 111,
    source: "cart", created_at: "2026-09-01T10:00:00Z",
    items: [{ course_id: "c-book", title: "کتاب تست 1", type: "book", unit_price_rial: 100000, requires_shipping: true }],
    course_ids: ["c-book"],
  },
  {
    // legacy order: snapshot WITHOUT requires_shipping / type
    id: "o2", user_id: "user1", status: "paid", amount_rial: 50000, ref_id: 222,
    source: "cart", created_at: "2026-09-02T10:00:00Z",
    items: [{ course_id: "c-lect", title: "جزوه فیزیک", unit_price_rial: 50000 }],
    course_ids: ["c-lect"],
  },
  {
    id: "o3", user_id: "user2", status: "paid", amount_rial: 100000, ref_id: 333,
    source: "cart", created_at: "2026-09-03T10:00:00Z",
    items: [{ course_id: "c-book", title: "کتاب تست 1", type: "book", unit_price_rial: 100000, requires_shipping: true }],
    course_ids: ["c-book"],
  },
  {
    // digital only → must NOT produce a shipment
    id: "o4", user_id: "user2", status: "paid", amount_rial: 2020, ref_id: 444,
    source: "direct", created_at: "2026-09-04T10:00:00Z",
    items: [{ course_id: "c-course", title: "دوره ریاضی", type: "course", unit_price_rial: 2020, requires_shipping: false }],
    course_ids: ["c-course"],
  },
  {
    // still pending payment → must be ignored
    id: "o5", user_id: "user1", status: "pending", amount_rial: 50000, ref_id: null,
    source: "cart", created_at: "2026-09-05T10:00:00Z",
    items: [{ course_id: "c-lect", title: "جزوه فیزیک", requires_shipping: true }],
    course_ids: ["c-lect"],
  },
];

DB.shipments = [
  // an already-registered shipment (must be kept untouched)
  {
    id: "ship-old", order_id: "o1", user_id: "user1", full_name: "علی رضایی",
    phone: "09121111111", province: "تهران", city: "تهران", address: "خیابان آزادی",
    postal_code: "1234567890", status: "sent", tracking_code: "111222", sent_at: "2026-09-06T10:00:00Z",
    created_at: "2026-09-01T11:00:00Z", updated_at: "2026-09-06T10:00:00Z",
  },
];

// ---- invoke the function ----
const call = async (body) => {
  const req = new Request("http://localhost/functions/v1/admin-shipments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await globalThis.__handler(req);
  return { status: res.status, body: await res.json() };
};

let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
};

console.log("── list (should self-heal: o2 gets a shipment) ──");
let r = await call({ token: TOKEN, action: "list" });
console.log("status", r.status);
console.log(
  "shipments:",
  DB.shipments.map((s) => `${s.order_id}:${s.status}`).join(" | ")
);

check("o1 keeps its existing (sent) shipment", DB.shipments.find((s) => s.order_id === "o1")?.status === "sent");
check("legacy order o2 (lecture) got a shipment created", !!DB.shipments.find((s) => s.order_id === "o2"));
check("digital order o4 did NOT get a shipment", !DB.shipments.find((s) => s.order_id === "o4"));
check("unpaid order o5 did NOT get a shipment", !DB.shipments.find((s) => s.order_id === "o5"));
check("address-less order o3 reported as missing", r.body.missing_shipments.some((m) => m.order_id === "o3"));
check("missing list carries customer phone for o3", r.body.missing_shipments.some((m) => m.phone === "09122222222"));
check("shipment rows include order + payment ref", r.body.shipments.every((s) => "order_id" in s && "ref_id" in s));
check("list returns 2 real shipments", r.body.shipments.length === 2, `got ${r.body.shipments.length}`);

console.log("\n── resync action ──");
r = await call({ token: TOKEN, action: "resync" });
console.log("sync:", JSON.stringify(r.body.sync));
check("resync is idempotent (creates 0 new)", r.body.sync.created === 0);
check("resync flags 1 order without address", r.body.sync.missing_address === 1);

console.log("\n── mark_sent ──");
r = await call({ token: TOKEN, action: "mark_sent", shipment_id: "ship-old", tracking_code: "999888" });
check("mark_sent succeeds", r.body.success === true);
r = await call({ token: TOKEN, action: "list" });
check("sent shipment keeps tracking code", r.body.shipments.some((s) => s.tracking_code === "999888"));

console.log("\n── auth ──");
r = await call({ token: "wrong-token", action: "list" });
check("bad token → 403", r.status === 403);
r = await call({ action: "list" });
check("missing token → 401", r.status === 401);

console.log("\n── db insert failure is surfaced to the admin ──");
{
  const { DB: DB2 } = await import("./supabase-stub.js");
  // fresh state: one physical order, no shipment, and the insert blows up
  DB2.shipments = [];
  DB2.orders = [{ id: "o9", user_id: "user1", status: "paid", amount_rial: 1000, ref_id: 1, source: "cart",
    items: [{ course_id: "c-book", title: "کتاب تست 1", type: "book", unit_price_rial: 1000, requires_shipping: true }], course_ids: ["c-book"] }];
  globalThis.__FAIL_INSERT = { shipments: 'null value in column "status" violates not-null constraint' };
  const rr = await call({ token: TOKEN, action: "list" });
  const orphan = rr.body.missing_shipments.find((m) => m.order_id === "o9");
  check("failed insert reported in missing_shipments", !!orphan);
  check("db error message surfaced as note", /not-null/.test(orphan?.note ?? ""), orphan?.note ?? "");
  globalThis.__FAIL_INSERT = null;
}

console.log("\n── DB writes ──");
console.log(LOG.filter((l) => l.startsWith("insert shipments")).join("\n"));

console.log(failures === 0 ? "\nALL CHECKS PASSED ✅" : `\n${failures} CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
