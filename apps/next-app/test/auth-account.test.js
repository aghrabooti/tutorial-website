import assert from "node:assert/strict";
import { createHash, pbkdf2Sync } from "node:crypto";
import { afterEach, test } from "node:test";
import { POST as loginUser } from "../app/api/functions/login-user/route.js";
import { POST as registerUser } from "../app/api/functions/register-user/route.js";
import { POST as updateProfile } from "../app/api/functions/update-profile/route.js";
import { POST as changePassword } from "../app/api/functions/change-password/route.js";
import { hashPassword, verifyPassword } from "../lib/password-hash.js";
import { normalizePhone } from "../lib/phone.js";

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

function tokenHash(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function mockRest({ user, session, existingUser = null, updatedUser = user }) {
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const record = { url, method, init };
    requests.push(record);

    if (url.pathname.endsWith("/user_sessions") && method === "GET") {
      return Response.json(session);
    }
    if (url.pathname.endsWith("/user_sessions") && method === "POST") {
      return new Response(null, { status: 201 });
    }
    if (url.pathname.endsWith("/user_sessions") && method === "PATCH") {
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/site_users") && method === "GET") {
      const select = url.searchParams.get("select");
      if (select === "id" && url.searchParams.has("phone")) {
        return Response.json(existingUser);
      }
      return Response.json(user);
    }
    if (url.pathname.endsWith("/site_users") && method === "POST") {
      return Response.json(updatedUser, { status: 201 });
    }
    if (url.pathname.endsWith("/site_users") && method === "PATCH") {
      return url.searchParams.has("select")
        ? Response.json(updatedUser)
        : new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected Supabase request: ${method} ${url}`);
  };
  return requests;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

test("PBKDF2 helper verifies existing salt:hash records and produces compatible hashes", async () => {
  const salt = "0123456789abcdef0123456789abcdef";
  const digest = pbkdf2Sync("existing-password", Buffer.from(salt, "hex"), 100_000, 32, "sha256").toString("hex");
  const stored = `${salt}:${digest}`;

  assert.equal(await verifyPassword("existing-password", stored), true);
  assert.equal(await verifyPassword("wrong-password", stored), false);
  assert.equal(await verifyPassword("existing-password", "malformed"), false);

  const generated = await hashPassword("new-password");
  assert.match(generated, /^[0-9a-f]{32}:[0-9a-f]{64}$/);
  assert.equal(await verifyPassword("new-password", generated), true);
});

test("phone helper preserves legacy Iranian mobile normalization", () => {
  assert.equal(normalizePhone(" 09 120000000 "), "989120000000");
  assert.equal(normalizePhone(" +98 9120000000 "), "989120000000");
});

test("POST /api/functions/login-user preserves old password records and creates a 30-day hashed session", async () => {
  setTestEnv();
  const passwordHash = await hashPassword("correct-password");
  const user = {
    id: "user-1",
    phone: "989120000000",
    password_hash: passwordHash,
    is_active: true,
    first_name: "سارا",
    last_name: "رضایی",
    grade: "11",
    major: "تجربی",
    role: "student",
  };
  const requests = mockRest({ user });

  const response = await loginUser(
    makeRequest("/api/functions/login-user", { phone: "09120000000", password: "correct-password" })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.success, true);
  assert.equal(body.user.id, "user-1");
  assert.equal(body.user.role, "student");
  assert.equal("password_hash" in body.user, false);
  assert.equal(typeof body.token, "string");
  assert.equal(body.token.length, 72);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url.searchParams.get("phone"), "eq.989120000000");
  const insertedSession = JSON.parse(requests[1].init.body);
  assert.equal(insertedSession.user_id, "user-1");
  assert.equal(insertedSession.token_hash, tokenHash(body.token));
  assert.ok(new Date(insertedSession.expires_at).getTime() > Date.now() + 29 * 24 * 60 * 60 * 1000);
});

test("POST /api/functions/login-user returns generic credentials errors and blocks inactive users", async () => {
  setTestEnv();
  const passwordHash = await hashPassword("correct-password");
  mockRest({ user: { id: "user-1", password_hash: passwordHash, is_active: true } });
  const wrongPassword = await loginUser(
    makeRequest("/api/functions/login-user", { phone: "09120000000", password: "wrong-password" })
  );
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(await wrongPassword.json(), { error: "شماره یا رمز اشتباه است" });

  mockRest({ user: { id: "user-2", password_hash: passwordHash, is_active: false } });
  const inactive = await loginUser(
    makeRequest("/api/functions/login-user", { phone: "09120000000", password: "correct-password" })
  );
  assert.equal(inactive.status, 403);
  assert.deepEqual(await inactive.json(), { error: "حساب کاربری غیرفعال است" });
});

test("POST /api/functions/register-user normalizes the phone and inserts a student with a compatible password hash", async () => {
  setTestEnv();
  const user = {
    id: "new-user",
    phone: "989120000000",
    full_name: "سارا رضایی",
  };
  const requests = mockRest({ user: null, existingUser: null, updatedUser: user });

  const response = await registerUser(
    makeRequest("/api/functions/register-user", {
      phone: " 09 120000000 ",
      password: "new-password",
      first_name: " سارا ",
      last_name: " رضایی ",
    })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { success: true, user });
  assert.equal(requests.length, 2);
  const insert = JSON.parse(requests[1].init.body);
  assert.equal(insert.phone, "989120000000");
  assert.equal(insert.first_name, "سارا");
  assert.equal(insert.last_name, "رضایی");
  assert.equal(insert.role, "student");
  assert.equal(await verifyPassword("new-password", insert.password_hash), true);
});

test("POST /api/functions/register-user rejects an existing phone before inserting", async () => {
  setTestEnv();
  const requests = mockRest({ user: null, existingUser: { id: "existing-user" } });

  const response = await registerUser(
    makeRequest("/api/functions/register-user", { phone: "09120000000", password: "valid-password" })
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "این شماره قبلاً ثبت شده است" });
  assert.equal(requests.length, 1);
});

test("POST /api/functions/update-profile requires a valid active session and preserves ninth-grade rules", async () => {
  setTestEnv();
  const token = "valid-profile-token";
  const session = {
    id: "session-1",
    user_id: "user-1",
    expires_at: "2099-01-01T00:00:00.000Z",
  };
  const updatedUser = {
    id: "user-1",
    phone: "989120000000",
    first_name: "علی",
    last_name: "رضایی",
    grade: "9",
    major: "",
  };
  const requests = mockRest({ session, updatedUser });

  const response = await updateProfile(
    makeRequest("/api/functions/update-profile", {
      token,
      first_name: " علی ",
      last_name: " رضایی ",
      grade: "9",
      major: "تجربی",
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, user: updatedUser });
  assert.equal(requests[0].url.searchParams.get("token_hash"), `eq.${tokenHash(token)}`);
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    first_name: "علی",
    last_name: "رضایی",
    grade: "9",
    major: "",
  });
});

test("POST /api/functions/change-password verifies PBKDF2, stores a compatible hash, and revokes other sessions", async () => {
  setTestEnv();
  const token = "valid-password-token";
  const currentHash = await hashPassword("current-password");
  const session = { id: "session-2", user_id: "user-2", expires_at: "2099-01-01T00:00:00.000Z" };
  const user = { id: "user-2", password_hash: currentHash };
  const requests = mockRest({ session, user });

  const response = await changePassword(
    makeRequest("/api/functions/change-password", {
      token,
      current_password: "current-password",
      new_password: "replacement-password",
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  const passwordUpdate = requests.find((request) => request.url.pathname.endsWith("/site_users") && request.method === "PATCH");
  const newHash = JSON.parse(passwordUpdate.init.body).password_hash;
  assert.equal(await verifyPassword("replacement-password", newHash), true);
  assert.equal(await verifyPassword("current-password", newHash), false);
  const sessionUpdate = requests.find((request) => request.url.pathname.endsWith("/user_sessions") && request.method === "PATCH");
  assert.equal(sessionUpdate.url.searchParams.get("id"), "neq.session-2");
});
