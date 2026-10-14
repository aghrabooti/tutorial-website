import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { POST as proxyEdgeFunction } from "../app/api/functions/[name]/route.js";

const envKeys = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

function setTestEnv() {
  process.env.SUPABASE_URL = "https://project.supabase.test/";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
}

function makeRequest(path, body, headers = { "Content-Type": "application/json" }) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers,
    body,
  });
}

function routeContext(name) {
  return { params: Promise.resolve({ name }) };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

test("legacy API calls proxy server-side with the anon key and preserve the Edge response", async () => {
  setTestEnv();
  let upstreamUrl;
  let upstreamInit;
  globalThis.fetch = async (input, init) => {
    upstreamUrl = String(input);
    upstreamInit = init;
    return new Response(JSON.stringify({ error: "شماره یا رمز اشتباه است" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  };

  const response = await proxyEdgeFunction(
    makeRequest("/api/functions/send-otp", JSON.stringify({ phone: "09120000000" })),
    routeContext("send-otp")
  );

  assert.equal(upstreamUrl, "https://project.supabase.test/functions/v1/send-otp");
  assert.equal(upstreamInit.method, "POST");
  assert.equal(upstreamInit.cache, "no-store");
  assert.equal(upstreamInit.redirect, "manual");
  assert.deepEqual(JSON.parse(upstreamInit.body), { phone: "09120000000" });
  const upstreamHeaders = new Headers(upstreamInit.headers);
  assert.equal(upstreamHeaders.get("apikey"), "test-anon-key");
  assert.equal(upstreamHeaders.get("authorization"), "Bearer test-anon-key");

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(await response.json(), { error: "شماره یا رمز اشتباه است" });
});

test("compatibility proxy only exposes explicitly allowlisted browser functions", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    throw new Error("unapproved functions must not be forwarded");
  };

  for (const name of [
    "sms-hook",
    "test-add-purchase",
    "admin-get-sessions-",
    "add-to-cart",
    "get-cart",
    "admin-get-courses",
    "admin-orders",
    "admin-create-course",
    "admin-update-course",
    "admin-save-sessions",
    "admin-overview",
    "admin-upload-url",
    "admin-shipments",
    "unknown-function",
  ]) {
    const response = await proxyEdgeFunction(
      makeRequest(`/api/functions/${name}`, "{}"),
      routeContext(name)
    );
    assert.equal(response.status, 404, name);
    assert.deepEqual(await response.json(), { error: "function not found" });
  }
  assert.equal(fetchCount, 0);
});

test("compatibility proxy rejects oversized, non-JSON, and malformed requests before forwarding", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    throw new Error("invalid requests must not be forwarded");
  };

  const oversized = await proxyEdgeFunction(
    makeRequest("/api/functions/send-otp", "{}", {
      "Content-Type": "application/json",
      "Content-Length": "1048577",
    }),
    routeContext("send-otp")
  );
  const wrongType = await proxyEdgeFunction(
    makeRequest("/api/functions/send-otp", "phone=x", {
      "Content-Type": "application/x-www-form-urlencoded",
    }),
    routeContext("send-otp")
  );
  const malformed = await proxyEdgeFunction(
    makeRequest("/api/functions/send-otp", "{"),
    routeContext("send-otp")
  );

  assert.equal(oversized.status, 413);
  assert.equal(wrongType.status, 415);
  assert.equal(malformed.status, 400);
  assert.equal(fetchCount, 0);
});

test("compatibility proxy fails closed if server environment is missing", async () => {
  process.env.SUPABASE_URL = "https://project.supabase.test";
  delete process.env.SUPABASE_ANON_KEY;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    throw new Error("fetch must not run without the anon key");
  };

  const response = await proxyEdgeFunction(
    makeRequest("/api/functions/send-otp", "{}"),
    routeContext("send-otp")
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "API compatibility service is not configured",
  });
  assert.equal(fetchCount, 0);
});
