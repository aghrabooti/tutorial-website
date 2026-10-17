import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { POST as proxyEdgeFunction } from "../app/api/functions/[name]/route.js";

const originalFetch = globalThis.fetch;
const MIGRATED_FUNCTIONS = [
  "get-course",
  "check-session",
  "logout-user",
  "login-user",
  "register-user",
  "update-profile",
  "change-password",
  "add-to-cart",
  "get-cart",
  "remove-from-cart",
  "get-my-address",
  "save-shipping-address",
  "get-my-courses",
  "check-course-access",
  "admin-get-courses",
  "admin-get-sessions",
  "admin-users",
  "admin-orders",
  "admin-create-course",
  "admin-update-course",
  "admin-save-sessions",
  "admin-overview",
  "admin-upload-url",
  "admin-shipments",
  "get-course-file",
  "get-course-sessions",
  "otp-verify",
  "payment-request",
  "payment-verify",
  "send-otp",
  "site-content",
];

function makeRequest(path, body = "{}") {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

function routeContext(name) {
  return { params: Promise.resolve({ name }) };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("empty compatibility allowlist rejects every migrated API without forwarding", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    throw new Error("the empty compatibility bridge must not call Edge");
  };

  for (const name of [...MIGRATED_FUNCTIONS, "sms-hook", "test-add-purchase", "unknown-function"]) {
    const response = await proxyEdgeFunction(
      makeRequest(`/api/functions/${name}`),
      routeContext(name)
    );
    assert.equal(response.status, 404, name);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "function not found" });
  }
  assert.equal(fetchCount, 0);
});

test("the compatibility handler fails closed without credentials, even for a migrated name", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    throw new Error("no request should leave the Next.js app");
  };

  try {
    const response = await proxyEdgeFunction(
      makeRequest("/api/functions/send-otp", "{"),
      routeContext("send-otp")
    );
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "function not found" });
    assert.equal(fetchCount, 0);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = previousKey;
  }
});
