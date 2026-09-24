// Tests for payment-request / payment-verify:
//   * real (production) gateway is used by default
//   * physical products always end up as a shipment for the admin panel
process.env.TZ = "UTC";

const REAL_MERCHANT = "11111111-2222-3333-4444-555555555555";

let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
};

function freshModules(env) {
  // reset db + env, then load a fresh copy of the bundles
  return { env };
}

const results = {};
async function scenario(name, env, fn) {
  console.log(`\n────────── ${name} ──────────`);
  const { DB } = await import("./supabase-stub.js");
  // wipe tables
  for (const k of Object.keys(DB)) DB[k] = [];

  globalThis.__ENV = env;
  // fresh module registry so module-level config picks up the new env
  const reqMod = await import(`./.build/payment-request.mjs?env=${encodeURIComponent(name)}`);
  const reqHandler = globalThis.__handler;
  const verMod = await import(`./.build/payment-verify.mjs?env=${encodeURIComponent(name)}-v`);
  const verHandler = globalThis.__handler;
  await fn({ DB, reqMod: reqHandler, verMod: verHandler });
}

const call = async (handler, body) => {
  const req = new Request("http://x/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await handler(req);
  return { status: res.status, body: await res.json() };
};

// ── fake zarinpal + session plumbing ──
function installFetchStub(handler, DB, userSessions) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    const out = await handler(String(url), init ? JSON.parse(init.body) : null);
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  };
  return calls;
}

const hash = async (t) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))))
    .map((b) => b.toString(16).padStart(2, "0")).join("");

const TOKEN = "user-token";

async function seedUser(DB) {
  DB.user_sessions = [{ id: "s1", user_id: "u1", token_hash: await hash(TOKEN), is_active: true, expires_at: "2030-01-01T00:00:00Z" }];
  DB.site_users = [{ id: "u1", role: "user", first_name: "علی", last_name: "رضایی", phone: "989121111111" }];
}

// ═════════════ scenario 1: production gateway, book purchase ═════════════
await scenario("production / book in cart", { ZARINPAL_MERCHANT_ID: REAL_MERCHANT, ZARINPAL_SANDBOX: undefined, ZARINPAL_CALLBACK_URL: "https://mahdiazizi.com/payment-result", PRICE_TO_RIAL_FACTOR: "10" }, async ({ DB, reqMod }) => {
  await seedUser(DB);
  DB.courses = [
    { id: "c-book", title: "کتاب تست 1", type: "book", price: 10000, discount_price: null, requires_shipping: true },
    { id: "c-course", title: "دوره ریاضی", type: "course", price: 2000, discount_price: null, requires_shipping: false },
  ];
  DB.cart_items = [
    { id: "ci1", user_id: "u1", course_id: "c-book" },
    { id: "ci2", user_id: "u1", course_id: "c-course" },
  ];
  const calls = installFetchStub(async () => ({ data: { code: 100, authority: "A00000000000000000000000000000123456" } }), DB);

  // 1) no address yet → blocked before payment
  let r = await call(reqMod, { token: TOKEN });
  check("physical cart without address → needs_address", r.body.needs_address === true, JSON.stringify(r.body));

  // 2) address saved, but not confirmed on this checkout → still blocked
  DB.user_addresses = [{ user_id: "u1", full_name: "علی رضایی", phone: "09121111111", province: "تهران", city: "تهران", address: "آزادی", postal_code: "1234567890" }];
  r = await call(reqMod, { token: TOKEN });
  check("physical cart without address_confirmed → needs_address", r.body.needs_address === true);

  // 3) confirmed → go to the REAL gateway
  r = await call(reqMod, { token: TOKEN, address_confirmed: true });
  check("checkout succeeds", r.body.success === true, JSON.stringify(r.body));
  check("pay_url points at the REAL zarinpal host", String(r.body.pay_url).startsWith("https://payment.zarinpal.com/pg/StartPay/"), r.body.pay_url);
  check("sandbox flag reported false", r.body.sandbox === false);
  check("merchant id sent to zarinpal", calls[0].body.merchant_id === REAL_MERCHANT);
  check("callback url sent", calls[0].body.callback_url === "https://mahdiazizi.com/payment-result");
  check("amount = sum of items * factor", calls[0].body.amount === 120000, String(calls[0].body.amount));

  const order = DB.orders[0];
  check("order snapshot marks the book as physical", order.items.find((i) => i.course_id === "c-book").requires_shipping === true);
  check("order snapshot marks the course as digital", order.items.find((i) => i.course_id === "c-course").requires_shipping === false);
  check("order status = pending with authority", order.status === "pending" && !!order.authority);
});

// ═════════════ scenario 2: verify → shipment appears for the admin ═════════════
await scenario("production / verify creates the shipment", { ZARINPAL_MERCHANT_ID: REAL_MERCHANT, ZARINPAL_CALLBACK_URL: "https://mahdiazizi.com/payment-result" }, async ({ DB, verMod }) => {
  DB.user_addresses = [{ user_id: "u1", full_name: "علی رضایی", phone: "09121111111", province: "تهران", city: "تهران", address: "خیابان آزادی", postal_code: "1234567890" }];
  DB.orders = [
    {
      id: "o1", user_id: "u1", status: "pending", authority: "A111", amount_rial: 100000, source: "cart",
      items: [{ course_id: "c-book", title: "کتاب تست 1", type: "book", unit_price_rial: 100000, requires_shipping: true }],
      course_ids: ["c-book"],
    },
    {
      id: "o2", user_id: "u1", status: "pending", authority: "A222", amount_rial: 20000, source: "direct",
      items: [{ course_id: "c-course", title: "دوره ریاضی", type: "course", unit_price_rial: 20000, requires_shipping: false }],
      course_ids: ["c-course"],
    },
  ];
  DB.cart_items = [{ id: "ci1", user_id: "u1", course_id: "c-book" }];

  const calls = installFetchStub(async (url) => {
    if (url.includes("verify.json")) return { data: { code: 100, ref_id: 987654321, card_pan: "6037****1234" } };
    return { data: { code: -9 } };
  }, DB);

  const r = await call(verMod, { authority: "A111" });
  check("verify succeeds", r.body.success === true && r.body.ref_id === 987654321, JSON.stringify(r.body));
  check("verify hit the REAL zarinpal host", calls[0].url.startsWith("https://payment.zarinpal.com/"), calls[0].url);
  check("needs_shipping flagged for the book order", r.body.needs_shipping === true);
  check("shipment created on success", r.body.shipment_created === true);

  const ship = DB.shipments.find((s) => s.order_id === "o1");
  check("shipment row has the address", ship && ship.province === "تهران" && ship.postal_code === "1234567890");
  check("shipment starts as pending", ship.status === "pending");
  check("order marked paid", DB.orders.find((o) => o.id === "o1").status === "paid");
  check("cart cleaned for purchased items", !DB.cart_items.find((c) => c.course_id === "c-book"));

  // re-verify (page refresh) → idempotent, no duplicate shipment
  const before = DB.shipments.length;
  const r2 = await call(verMod, { authority: "A111" });
  check("re-verify is idempotent (already=true)", r2.body.already === true);
  check("no duplicate shipment on re-verify", DB.shipments.length === before);

  // digital order → no shipment
  const r3 = await call(verMod, { authority: "A222" });
  check("digital order verified", r3.body.success === true);
  check("digital order creates NO shipment", !DB.shipments.find((s) => s.order_id === "o2"));
});

// ═════════════ scenario 3: sandbox authority is detected automatically ═════════════
await scenario("production config + sandbox authority", { ZARINPAL_MERCHANT_ID: REAL_MERCHANT, ZARINPAL_CALLBACK_URL: "https://mahdiazizi.com/payment-result" }, async ({ DB, verMod }) => {
  DB.orders = [{ id: "o1", user_id: "u1", status: "pending", authority: "S111", amount_rial: 1000, source: "direct", items: [], course_ids: [] }];
  const calls = installFetchStub(async (url) =>
    url.includes("sandbox.zarinpal.com")
      ? { data: { code: 100, ref_id: 42 } }
      : { errors: { code: -54, message: "Session is invalid" } }
  , DB);
  const r = await call(verMod, { authority: "S111" });
  check("sandbox authority verified on the sandbox host", calls[0].url.startsWith("https://sandbox.zarinpal.com/"), calls[0].url);
  check("sandbox verify succeeded", r.body.success === true && r.body.ref_id === 42);
});

// ═════════════ scenario 4: env mismatch fallback (prod first, then sandbox) ═════════════
await scenario("env fallback", { ZARINPAL_MERCHANT_ID: REAL_MERCHANT, ZARINPAL_CALLBACK_URL: "https://mahdiazizi.com/payment-result" }, async ({ DB, verMod }) => {
  DB.orders = [{ id: "o1", user_id: "u1", status: "pending", authority: "A333", amount_rial: 1000, source: "direct", items: [], course_ids: [] }];
  const calls = installFetchStub(async (url) =>
    url.includes("sandbox.zarinpal.com")
      ? { data: { code: 100, ref_id: 55 } }
      : { errors: { code: -54, message: "Session is invalid" } }
  , DB);
  const r = await call(verMod, { authority: "A333" });
  check("first attempt on production host", calls[0]?.url.startsWith("https://payment.zarinpal.com/"));
  check("retried against the sandbox host", calls[1]?.url.startsWith("https://sandbox.zarinpal.com/"));
  check("payment still verified via fallback", r.body.success === true && r.body.ref_id === 55);
});

// ═════════════ scenario 5: sandbox mode + unconfigured gateway ═════════════
await scenario("test merchant → sandbox; missing merchant → error", { ZARINPAL_MERCHANT_ID: REAL_MERCHANT, ZARINPAL_SANDBOX: "true", ZARINPAL_CALLBACK_URL: "https://mahdiazizi.com/payment-result" }, async ({ DB, reqMod }) => {
  await seedUser(DB);
  DB.courses = [{ id: "c-course", title: "دوره", type: "course", price: 2000, discount_price: null, requires_shipping: false }];
  DB.cart_items = [{ id: "ci1", user_id: "u1", course_id: "c-course" }];
  const calls = installFetchStub(async () => ({ data: { code: 100, authority: "S00000000000000000000000000000123456" } }), DB);

  let r = await call(reqMod, { token: TOKEN });
  check("explicit sandbox flag → sandbox pay url", String(r.body.pay_url).startsWith("https://sandbox.zarinpal.com/pg/StartPay/"), r.body.pay_url);
  check("sandbox flag returned", r.body.sandbox === true);
  check("digital order skips the address step", r.body.success === true);
});

await scenario("missing merchant id", { ZARINPAL_CALLBACK_URL: "https://mahdiazizi.com/payment-result" }, async ({ DB, reqMod }) => {
  await seedUser(DB);
  DB.courses = [{ id: "c-course", title: "دوره", type: "course", price: 2000, requires_shipping: false }];
  DB.cart_items = [{ id: "ci1", user_id: "u1", course_id: "c-course" }];
  installFetchStub(async () => ({}), DB);
  const r = await call(reqMod, { token: TOKEN });
  check("missing merchant → 500", r.status === 500, JSON.stringify(r.body));
  check("gateway_configured=false in the response", r.body.gateway_configured === false);
  check("clear Persian error message", /ZARINPAL_MERCHANT_ID/.test(r.body.error ?? ""));
});

await scenario("test uuid merchant (00..00) → sandbox", { ZARINPAL_MERCHANT_ID: "00000000-0000-0000-0000-000000000000", ZARINPAL_CALLBACK_URL: "https://mahdiazizi.com/payment-result" }, async ({ DB, reqMod }) => {
  await seedUser(DB);
  DB.courses = [{ id: "c-course", title: "دوره", type: "course", price: 2000, requires_shipping: false }];
  DB.cart_items = [{ id: "ci1", user_id: "u1", course_id: "c-course" }];
  installFetchStub(async () => ({ data: { code: 100, authority: "S00000000000000000000000000000123456" } }), DB);
  const r = await call(reqMod, { token: TOKEN });
  check("test merchant routes to sandbox", String(r.body.pay_url).includes("sandbox.zarinpal.com"), r.body.pay_url);
  check("no https callback needed in sandbox", r.body.success === true);
});

console.log(failures === 0 ? "\nALL PAYMENT CHECKS PASSED ✅" : `\n${failures} CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
