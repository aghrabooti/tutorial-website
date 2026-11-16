import assert from "node:assert/strict";
import test from "node:test";

test("local checkout records the authority before redirect and retries a failed settlement write", async (t) => {
  const env = {
    DATABASE_API_URL: "http://db-api.test",
    ZARINPAL_MERCHANT_ID: "00000000-0000-0000-0000-000000000000",
    ZARINPAL_SANDBOX: "true",
    ZARINPAL_CALLBACK_URL: "https://school.test/payment-result",
    PRICE_TO_RIAL_FACTOR: "10",
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, env);

  const { POST: checkout } = await import("../app/api/functions/payment-request/route.js");
  const { POST: verify } = await import("../app/api/functions/payment-verify/route.js");
  const checkoutRequest = () => new Request("https://school.test/api/functions/payment-request", {
    method: "POST",
    body: JSON.stringify({ token: "student-session", course_id: "course-1" }),
  });
  const verifyRequest = () => new Request("https://school.test/api/functions/payment-verify", {
    method: "POST",
    body: JSON.stringify({ authority: "S-test-order" }),
  });
  let order;
  let allowAuthoritySave = false;
  let allowPaidSave = false;
  let verificationCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : null;
    if (url.hostname === "sandbox.zarinpal.com") {
      assert.equal(body.amount, 1500);
      if (url.pathname.endsWith("/request.json")) {
        return Response.json({ data: { code: 100, authority: "S-test-order" } });
      }
      assert.equal(body.authority, order.authority);
      verificationCalls++;
      return Response.json({ data: { code: verificationCalls > 1 ? 101 : 100, ref_id: 1234 } });
    }
    assert.equal(url.hostname, "db-api.test");
    switch (url.pathname) {
      case "/user_sessions":
        return Response.json([{ id: "session-1", user_id: "student-1", expires_at: "2099-01-01" }]);
      case "/site_users":
        return Response.json([{ id: "student-1", phone: "989123456789" }]);
      case "/courses":
        return Response.json([{ id: "course-1", title: "Math", type: "course", price: 200, discount_price: 150 }]);
      case "/orders":
        if (init.method === "POST") {
          order = { ...body, id: "order-1" };
          return Response.json([{ id: order.id }], { status: 201 });
        }
        if (init.method === "GET") {
          return Response.json(url.searchParams.has("authority") ? [order] : []);
        }
        if (body.status === "pending" && !allowAuthoritySave || body.status === "paid" && !allowPaidSave) {
          return Response.json({ code: "DB_ERROR", message: "Temporarily unavailable" }, { status: 503 });
        }
        order = { ...order, ...body };
        return url.searchParams.has("select")
          ? Response.json([{ id: order.id }])
          : new Response(null, { status: 204 });
      default:
        throw new Error("Unexpected route " + url);
    }
  };

  assert.equal((await checkout(checkoutRequest())).status, 503);
  allowAuthoritySave = true;
  const started = await checkout(checkoutRequest());
  assert.equal(started.status, 200);
  assert.equal((await started.json()).pay_url, "https://sandbox.zarinpal.com/pg/StartPay/S-test-order");
  assert.equal(order.status, "pending");
  assert.equal(order.amount_rial, 1500);
  assert.equal((await verify(verifyRequest())).status, 503);
  assert.equal(order.status, "pending");
  allowPaidSave = true;
  assert.equal((await verify(verifyRequest())).status, 200);
  assert.equal(order.status, "paid");
  assert.equal((await (await verify(verifyRequest())).json()).already, true);
  assert.equal(verificationCalls, 2);
});
