import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";
import { POST as checkSession } from "../app/api/functions/check-session/route.js";
import { POST as logoutUser } from "../app/api/functions/logout-user/route.js";
import {
  installPostgresPoolForTests,
  resetPostgresPoolForTests,
} from "../lib/postgres.js";

const envKeys = ["DATABASE_URL"];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

function setTestEnv() {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
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

function installMockPool(handler) {
  const queries = [];
  installPostgresPoolForTests({
    async query(text, values = []) {
      queries.push({ text, values });
      return handler(text, values);
    },
  });
  return queries;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetPostgresPoolForTests();
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

test("POST /api/functions/check-session hashes the token, returns safe user fields, and disables caching", async () => {
  setTestEnv();
  const token = "legacy-session-token";
  const queries = installMockPool(async (text) => {
    if (text.includes("FROM public.user_sessions")) {
      return {
        rows: [{
          id: "session-1",
          user_id: "user-1",
          expires_at: new Date("2099-01-01T00:00:00.000Z"),
          expired: false,
        }],
        rowCount: 1,
      };
    }
    if (text.includes("FROM public.site_users")) {
      return {
        rows: [{
          id: "user-1",
          phone: "989120000000",
          first_name: "سارا",
          last_name: "رضایی",
          role: "student",
        }],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

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
  assert.equal(queries.length, 2);
  assert.match(queries[0].text, /token_hash = \$1/);
  assert.match(queries[0].text, /is_active IS TRUE/);
  assert.deepEqual(queries[0].values, [sha256(token)]);
  assert.match(queries[1].text, /SELECT id, phone, first_name, last_name, role/);
  assert.deepEqual(queries[1].values, ["user-1"]);
});

test("POST /api/functions/check-session deactivates an expired session and does not fetch the user", async () => {
  setTestEnv();
  const queries = installMockPool(async (text) => {
    if (text.includes("FROM public.user_sessions")) {
      return {
        rows: [{ id: "expired-session", user_id: "user-1", expired: true }],
        rowCount: 1,
      };
    }
    if (text.includes("UPDATE public.user_sessions")) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await checkSession(
    makeRequest("/api/functions/check-session", { token: "expired-token" })
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "نشست منقضی شده" });
  assert.equal(queries.length, 2);
  assert.match(queries[1].text, /SET is_active = false WHERE id = \$1/);
  assert.deepEqual(queries[1].values, ["expired-session"]);
});

test("POST /api/functions/check-session rejects malformed or missing tokens before querying", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    throw new Error("No external request should be made");
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

test("session routes fail closed when the database is not configured", async () => {
  delete process.env.DATABASE_URL;
  resetPostgresPoolForTests();
  const response = await checkSession(
    makeRequest("/api/functions/check-session", { token: "test-session-token" })
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "سرویس نشست تنظیم نشده است" });
});

test("POST /api/functions/logout-user marks the active PostgreSQL session inactive", async () => {
  setTestEnv();
  const token = "legacy-session-token";
  const queries = installMockPool(async (text) => {
    if (text.includes("SELECT id FROM public.user_sessions")) {
      return { rows: [{ id: "session-2" }], rowCount: 1 };
    }
    if (text.includes("UPDATE public.user_sessions")) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await logoutUser(
    makeRequest("/api/functions/logout-user", { token })
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    success: true,
    message: "با موفقیت خارج شدید",
  });
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0].values, [sha256(token)]);
  assert.match(queries[1].text, /SET is_active = false WHERE id = \$1/);
  assert.deepEqual(queries[1].values, ["session-2"]);
});

test("POST /api/functions/logout-user rejects a token without a matching session", async () => {
  setTestEnv();
  installMockPool(async () => ({ rows: [], rowCount: 0 }));

  const response = await logoutUser(
    makeRequest("/api/functions/logout-user", { token: "unknown-token" })
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Session پیدا نشد" });
});
