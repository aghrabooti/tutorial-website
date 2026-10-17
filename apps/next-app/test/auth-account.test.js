import assert from "node:assert/strict";
import { createHash, pbkdf2Sync } from "node:crypto";
import { afterEach, test } from "node:test";
import { POST as loginUser } from "../app/api/functions/login-user/route.js";
import { POST as registerUser } from "../app/api/functions/register-user/route.js";
import { POST as updateProfile } from "../app/api/functions/update-profile/route.js";
import { POST as changePassword } from "../app/api/functions/change-password/route.js";
import { hashPassword, verifyPassword } from "../lib/password-hash.js";
import { normalizePhone } from "../lib/phone.js";
import {
  installPostgresPoolForTests,
  resetPostgresPoolForTests,
} from "../lib/postgres.js";

const envKeys = ["DATABASE_URL"];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

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

function tokenHash(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function mockPostgres(handler) {
  const requests = [];
  installPostgresPoolForTests({
    async query(text, values = []) {
      requests.push({ text, values });
      return handler(text, values);
    },
  });
  return requests;
}

afterEach(() => {
  resetPostgresPoolForTests();
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

test("POST /api/functions/login-user preserves password records and creates a 30-day hashed PostgreSQL session", async () => {
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
  const requests = mockPostgres(async (text) => {
    if (text.includes("SELECT * FROM public.site_users")) return { rows: [user], rowCount: 1 };
    if (text.includes("INSERT INTO public.user_sessions")) return { rows: [], rowCount: 1 };
    if (text.includes("UPDATE public.site_users")) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${text}`);
  });

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
  assert.match(requests[0].text, /WHERE phone = \$1/);
  assert.deepEqual(requests[0].values, ["989120000000"]);
  assert.match(requests[1].text, /INSERT INTO public\.user_sessions/);
  assert.equal(requests[1].values[0], "user-1");
  assert.equal(requests[1].values[1], tokenHash(body.token));
  assert.ok(new Date(requests[1].values[2]).getTime() > Date.now() + 29 * 24 * 60 * 60 * 1000);
});

test("POST /api/functions/login-user returns generic credential errors and blocks inactive users", async () => {
  setTestEnv();
  const passwordHash = await hashPassword("correct-password");
  mockPostgres(async (text) => {
    if (text.includes("SELECT * FROM public.site_users")) {
      return { rows: [{ id: "user-1", password_hash: passwordHash, is_active: true }], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const wrongPassword = await loginUser(
    makeRequest("/api/functions/login-user", { phone: "09120000000", password: "wrong-password" })
  );
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(await wrongPassword.json(), { error: "شماره یا رمز اشتباه است" });

  mockPostgres(async (text) => {
    if (text.includes("SELECT * FROM public.site_users")) {
      return { rows: [{ id: "user-2", password_hash: passwordHash, is_active: false }], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const inactive = await loginUser(
    makeRequest("/api/functions/login-user", { phone: "09120000000", password: "correct-password" })
  );
  assert.equal(inactive.status, 403);
  assert.deepEqual(await inactive.json(), { error: "حساب کاربری غیرفعال است" });
});

test("POST /api/functions/register-user normalizes the phone and stores a compatible password hash", async () => {
  setTestEnv();
  const user = { id: "new-user", phone: "989120000000", full_name: "سارا رضایی" };
  const requests = mockPostgres(async (text) => {
    if (text.includes("SELECT id FROM public.site_users")) return { rows: [], rowCount: 0 };
    if (text.includes("INSERT INTO public.site_users")) return { rows: [user], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${text}`);
  });

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
  assert.match(requests[1].text, /INSERT INTO public\.site_users/);
  assert.equal(requests[1].values[0], "989120000000");
  assert.equal(requests[1].values[2], "سارا");
  assert.equal(requests[1].values[3], "رضایی");
  assert.equal(await verifyPassword("new-password", requests[1].values[1]), true);
});

test("POST /api/functions/register-user rejects an existing phone before inserting", async () => {
  setTestEnv();
  const requests = mockPostgres(async (text) => {
    if (text.includes("SELECT id FROM public.site_users")) {
      return { rows: [{ id: "existing-user" }], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await registerUser(
    makeRequest("/api/functions/register-user", { phone: "09120000000", password: "valid-password" })
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "این شماره قبلاً ثبت شده است" });
  assert.equal(requests.length, 1);
});

test("POST /api/functions/update-profile requires an active PostgreSQL session and preserves ninth-grade rules", async () => {
  setTestEnv();
  const token = "valid-profile-token";
  const updatedUser = {
    id: "user-1",
    phone: "989120000000",
    first_name: "علی",
    last_name: "رضایی",
    grade: "9",
    major: "",
  };
  const requests = mockPostgres(async (text) => {
    if (text.includes("FROM public.user_sessions")) {
      return { rows: [{ id: "session-1", user_id: "user-1", expired: false }], rowCount: 1 };
    }
    if (text.includes("UPDATE public.site_users")) return { rows: [updatedUser], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${text}`);
  });

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
  assert.equal(requests[0].values[0], tokenHash(token));
  assert.deepEqual(requests[1].values, ["user-1", "علی", "رضایی", "9", ""]);
});

test("POST /api/functions/change-password verifies PBKDF2, stores a compatible hash, and revokes other sessions", async () => {
  setTestEnv();
  const token = "valid-password-token";
  const currentHash = await hashPassword("current-password");
  const requests = mockPostgres(async (text) => {
    if (text.includes("FROM public.user_sessions")) {
      return { rows: [{ id: "session-2", user_id: "user-2", expired: false }], rowCount: 1 };
    }
    if (text.includes("SELECT id, password_hash FROM public.site_users")) {
      return { rows: [{ id: "user-2", password_hash: currentHash }], rowCount: 1 };
    }
    if (text.includes("UPDATE public.site_users")) return { rows: [], rowCount: 1 };
    if (text.includes("UPDATE public.user_sessions")) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await changePassword(
    makeRequest("/api/functions/change-password", {
      token,
      current_password: "current-password",
      new_password: "replacement-password",
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  const passwordUpdate = requests.find((request) => request.text.includes("UPDATE public.site_users"));
  const newHash = passwordUpdate.values[1];
  assert.equal(await verifyPassword("replacement-password", newHash), true);
  assert.equal(await verifyPassword("current-password", newHash), false);
  const sessionUpdate = requests.find((request) => request.text.includes("UPDATE public.user_sessions"));
  assert.deepEqual(sessionUpdate.values, ["user-2", "session-2"]);
});
