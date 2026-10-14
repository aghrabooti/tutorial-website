import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";
import { POST as checkSession } from "../app/api/functions/check-session/route.js";
import { POST as logoutUser } from "../app/api/functions/logout-user/route.js";

const envKeys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

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

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

test("POST /api/functions/check-session hashes the token, returns the safe user fields, and disables caching", async () => {
  setTestEnv();
  const token = "legacy-session-token";
  const requests = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    requests.push({ url, method, init });

    if (url.pathname.endsWith("/user_sessions")) {
      return Response.json({
        id: "session-1",
        user_id: "user-1",
        expires_at: "2099-01-01T00:00:00.000Z",
      });
    }
    if (url.pathname.endsWith("/site_users")) {
      return Response.json({
        id: "user-1",
        phone: "989120000000",
        first_name: "سارا",
        last_name: "رضایی",
        role: "student",
      });
    }
    throw new Error(`Unexpected Supabase request: ${url}`);
  };

  const response = await checkSession(
    makeRequest("/api/functions/check-session", { token })
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    success: true,
    user: {
      id: "user-1",
      phone: "989120000000",
      first_name: "سارا",
      last_name: "رضایی",
      role: "student",
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.searchParams.get("token_hash"), `eq.${sha256(token)}`);
  assert.equal(requests[0].url.searchParams.get("is_active"), "eq.true");
  assert.equal(requests[0].url.searchParams.get("select"), "id,user_id,expires_at");
  assert.equal(requests[1].url.searchParams.get("select"), "id,phone,first_name,last_name,role");
  for (const { init } of requests) {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("apikey"), "test-service-role-key");
    assert.equal(headers.get("authorization"), "Bearer test-service-role-key");
  }
});

test("POST /api/functions/check-session deactivates an expired session and does not fetch the user", async () => {
  setTestEnv();
  const requests = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init, method: init?.method ?? "GET" });
    if (url.pathname.endsWith("/user_sessions") && (init?.method ?? "GET") === "GET") {
      return Response.json({
        id: "expired-session",
        user_id: "user-1",
        expires_at: "2000-01-01T00:00:00.000Z",
      });
    }
    if (url.pathname.endsWith("/user_sessions") && init?.method === "PATCH") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected Supabase request: ${url}`);
  };

  const response = await checkSession(
    makeRequest("/api/functions/check-session", { token: "expired-token" })
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "نشست منقضی شده" });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].method, "PATCH");
  assert.equal(requests[1].url.searchParams.get("id"), "eq.expired-session");
  assert.deepEqual(JSON.parse(requests[1].init.body), { is_active: false });
});

test("POST /api/functions/check-session rejects malformed or missing tokens before querying", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    throw new Error("Supabase must not be queried for an invalid token");
  };

  const malformed = await checkSession(
    new Request("http://localhost/api/functions/check-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    })
  );
  const missing = await checkSession(
    makeRequest("/api/functions/check-session", { token: "  " })
  );
  const wrongType = await checkSession(
    makeRequest("/api/functions/check-session", { token: 123 })
  );
  const oversized = await checkSession(
    makeRequest("/api/functions/check-session", { token: "t".repeat(513) })
  );

  assert.equal(malformed.status, 400);
  assert.equal(missing.status, 400);
  assert.equal(wrongType.status, 400);
  assert.equal(oversized.status, 400);
  assert.equal(fetchCount, 0);
});

test("session routes fail closed when server credentials are missing", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    throw new Error("Supabase must not be queried without server credentials");
  };

  const response = await checkSession(
    makeRequest("/api/functions/check-session", { token: "test-session-token" })
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "سرویس نشست تنظیم نشده است" });
  assert.equal(fetchCount, 0);
});

test("POST /api/functions/logout-user marks the active session inactive", async () => {
  setTestEnv();
  const token = "legacy-session-token";
  const requests = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init, method: init?.method ?? "GET" });
    if (url.pathname.endsWith("/user_sessions") && (init?.method ?? "GET") === "GET") {
      return Response.json({ id: "session-2" });
    }
    if (url.pathname.endsWith("/user_sessions") && init?.method === "PATCH") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected Supabase request: ${url}`);
  };

  const response = await logoutUser(
    makeRequest("/api/functions/logout-user", { token })
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    success: true,
    message: "با موفقیت خارج شدید",
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.searchParams.get("token_hash"), `eq.${sha256(token)}`);
  assert.equal(requests[1].method, "PATCH");
  assert.equal(requests[1].url.searchParams.get("id"), "eq.session-2");
  assert.deepEqual(JSON.parse(requests[1].init.body), { is_active: false });
});

test("POST /api/functions/logout-user rejects a token without a matching session", async () => {
  setTestEnv();
  globalThis.fetch = async () => Response.json(null);

  const response = await logoutUser(
    makeRequest("/api/functions/logout-user", { token: "unknown-token" })
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Session پیدا نشد" });
});
