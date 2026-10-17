// Tests for the incremental browser-to-Next API migration.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const apiSource = read("js/api.js");
const proxySource = read("apps/next-app/app/api/functions/[name]/route.js");

function listJavaScriptFiles(directory) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? listJavaScriptFiles(relativePath)
      : relativePath.endsWith(".js")
        ? [relativePath]
        : [];
  });
}

function makeApiContext() {
  const calls = [];
  const sandbox = {
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          data: [{ id: "course-1" }],
          error: null,
          success: true,
          content: { "home.title": "ok" },
        }),
      };
    },
    JSON,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(apiSource, sandbox);
  return { sandbox, calls };
}

test("migrated get-course uses the same-origin Next route and keeps its body", async () => {
  const { sandbox, calls } = makeApiContext();
  const result = await sandbox.apiCall("get-course", { course_id: "course-1" });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/functions/get-course");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls[0].options.body), { course_id: "course-1" });
});

test("session validation and logout use same-origin Next routes and retain the token body", async () => {
  const { sandbox, calls } = makeApiContext();
  await sandbox.apiCall("check-session", { token: "session-token" });
  await sandbox.apiCall("logout-user", { token: "session-token" });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/functions/check-session");
  assert.equal(calls[1].url, "/api/functions/logout-user");
  for (const call of calls) {
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(call.options.body), { token: "session-token" });
  }
  assert.ok(!apiSource.includes("SUPABASE_SERVICE_ROLE_KEY"));
});

test("public site-content reads and admin writes use dedicated same-origin Next routes", async () => {
  const { sandbox, calls } = makeApiContext();
  await sandbox.apiCall("site-content", { action: "get" });
  await sandbox.apiCall("site-content", { action: null });
  await sandbox.apiCall("site-content", { action: "set", token: "admin", items: { "home.title": "new" } });

  assert.equal(calls[0].url, "/api/site-content");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[1].url, "/api/site-content");
  assert.equal(calls[1].options.method, "GET");
  assert.equal(calls[2].url, "/api/functions/site-content");
  assert.equal(calls[2].options.method, "POST");
  assert.equal(calls[2].options.headers.Authorization, undefined);
});

test("login, registration, and account changes use their same-origin Next routes", async () => {
  const { sandbox, calls } = makeApiContext();
  await sandbox.apiCall("login-user", { phone: "09120000000", password: "secret" });
  await sandbox.apiCall("register-user", { phone: "09120000000", password: "secret" });
  await sandbox.apiCall("update-profile", { token: "session", first_name: "سارا" });
  await sandbox.apiCall("change-password", { token: "session", current_password: "old", new_password: "new" });

  assert.deepEqual(calls.map((call) => call.url), [
    "/api/functions/login-user",
    "/api/functions/register-user",
    "/api/functions/update-profile",
    "/api/functions/change-password",
  ]);
  for (const call of calls) {
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.headers.Authorization, undefined);
  }
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    phone: "09120000000",
    password: "secret",
  });
  assert.ok(!apiSource.includes("supabase.co/functions/v1"));
  assert.ok(!apiSource.includes("SUPABASE_ANON_KEY"));
  assert.ok(!apiSource.includes("SUPABASE_SERVICE_ROLE_KEY"));

  const registrationSource = read("js/register.js");
  assert.ok(
    registrationSource.indexOf('apiCall(\n            "otp-verify"') <
      registrationSource.indexOf('apiCall(\n            "register-user"'),
    "OTP must still be verified before register-user is called"
  );
});

test("cart, access, and shipping APIs use dedicated same-origin Next routes", async () => {
  const { sandbox, calls } = makeApiContext();
  await sandbox.apiCall("add-to-cart", { token: "session", course_id: "course-1" });
  await sandbox.apiCall("get-cart", { token: "session" });
  await sandbox.apiCall("remove-from-cart", { token: "session", cart_item_id: "item-1" });
  await sandbox.apiCall("get-my-address", { token: "session" });
  await sandbox.apiCall("save-shipping-address", { token: "session", city: "تهران" });
  await sandbox.apiCall("get-my-courses", { token: "session" });
  await sandbox.apiCall("check-course-access", { token: "session", course_id: "course-1" });

  assert.deepEqual(calls.map((call) => call.url), [
    "/api/functions/add-to-cart",
    "/api/functions/get-cart",
    "/api/functions/remove-from-cart",
    "/api/functions/get-my-address",
    "/api/functions/save-shipping-address",
    "/api/functions/get-my-courses",
    "/api/functions/check-course-access",
  ]);
  for (const call of calls) {
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.headers.Authorization, undefined);
  }
});

test("admin read APIs use dedicated same-origin Next routes", async () => {
  const { sandbox, calls } = makeApiContext();
  await sandbox.apiCall("admin-get-courses", { token: "admin-session" });
  await sandbox.apiCall("admin-get-sessions", { token: "admin-session", course_id: "course-1" });
  await sandbox.apiCall("admin-users", { token: "admin-session" });
  await sandbox.apiCall("admin-orders", { token: "admin-session" });

  assert.deepEqual(calls.map((call) => call.url), [
    "/api/functions/admin-get-courses",
    "/api/functions/admin-get-sessions",
    "/api/functions/admin-users",
    "/api/functions/admin-orders",
  ]);
  for (const call of calls) {
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.headers.Authorization, undefined);
  }
});

test("admin write and overview APIs use their dedicated Next routes", async () => {
  const { sandbox, calls } = makeApiContext();
  await sandbox.apiCall("admin-create-course", { token: "admin-session", title: "ریاضی", type: "course" });
  await sandbox.apiCall("admin-update-course", { token: "admin-session", course_id: "course-1", title: "جبر" });
  await sandbox.apiCall("admin-save-sessions", { token: "admin-session", course_id: "course-1", sessions: [] });
  await sandbox.apiCall("admin-overview", { token: "admin-session" });
  await sandbox.apiCall("admin-shipments", { token: "admin-session", action: "list" });

  assert.deepEqual(calls.map((call) => call.url), [
    "/api/functions/admin-create-course",
    "/api/functions/admin-update-course",
    "/api/functions/admin-save-sessions",
    "/api/functions/admin-overview",
    "/api/functions/admin-shipments",
  ]);
  for (const call of calls) {
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.headers.Authorization, undefined);
  }
});

test("admin upload URLs use the dedicated same-origin Next route", async () => {
  const { sandbox, calls } = makeApiContext();
  await sandbox.apiCall("admin-upload-url", { token: "admin-session", kind: "image", filename: "cover.jpg" });

  assert.equal(calls[0].url, "/api/functions/admin-upload-url");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test("the seven migrated Edge APIs use dedicated same-origin Next routes", async () => {
  const { sandbox, calls } = makeApiContext();
  await sandbox.apiCall("get-course-file", { token: "session", course_id: "course-1" });
  await sandbox.apiCall("get-course-sessions", { token: "session", course_id: "course-1" });
  await sandbox.apiCall("otp-verify", { phone: "09120000000", code: "123456", purpose: "register" });
  await sandbox.apiCall("payment-request", { token: "session" });
  await sandbox.apiCall("payment-verify", { authority: "A-1" });
  await sandbox.apiCall("send-otp", { phone: "09120000000" });
  await sandbox.apiCall("site-content", { token: "admin", action: "set", items: { "home.title": "new" } });

  assert.deepEqual(calls.map((call) => call.url), [
    "/api/functions/get-course-file",
    "/api/functions/get-course-sessions",
    "/api/functions/otp-verify",
    "/api/functions/payment-request",
    "/api/functions/payment-verify",
    "/api/functions/send-otp",
    "/api/functions/site-content",
  ]);
  for (const call of calls) {
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.headers.Authorization, undefined);
  }
  assert.deepEqual(JSON.parse(calls[5].options.body), { phone: "09120000000" });
});

test("public course cards use the same-origin endpoint rather than Supabase JS", async () => {
  const { sandbox, calls } = makeApiContext();
  const result = await sandbox.getPublicCourses();

  assert.deepEqual(result.data, [{ id: "course-1" }]);
  assert.equal(result.error, null);
  assert.equal(calls[0].url, "/api/courses");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.ok(!read("js/courses.js").includes("supabaseClient"));
  assert.ok(!read("js/home.js").includes('.from("courses")'));
  assert.ok(!read("js/admin.js").includes('.from("courses")'));
  assert.ok(!read("index.html").includes("/js/supabase-client.js"));
  assert.ok(!read("admin.html").includes("/js/supabase-client.js"));
  assert.ok(!read("admin.html").includes("@supabase/supabase-js"));
  assert.ok(!read("courses.html").includes("@supabase/supabase-js"));
});

test("public site-content client no longer hardcodes the Supabase endpoint/key", () => {
  const siteContent = read("js/site-content.js");
  assert.ok(siteContent.includes("/api/site-content"));
  assert.ok(!siteContent.includes("supabase.co/functions/v1"));
  assert.ok(!siteContent.includes("SUPABASE_ANON_KEY"));
});

test("every browser apiCall function is handled locally or by the explicit Edge proxy allowlist", () => {
  const calledFunctions = new Set();
  for (const file of listJavaScriptFiles("js")) {
    const source = read(file);
    for (const match of source.matchAll(/apiCall\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
      calledFunctions.add(match[1]);
    }
  }

  const localRoutes = new Set([
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
  ]);
  const allowlistSource = proxySource.match(/const EDGE_FUNCTIONS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(allowlistSource, "proxy allowlist should exist");
  const proxiedFunctions = new Set(
    [...allowlistSource[1].matchAll(/["']([a-z0-9-]+)["']/g)].map((match) => match[1])
  );
  const browserProxyFunctions = new Set([...calledFunctions].filter((name) => !localRoutes.has(name)));

  assert.deepEqual([...browserProxyFunctions].sort(), [...proxiedFunctions].sort());
  assert.ok(!read("js/api.js").includes("supabase.co/functions/v1"));
  assert.ok(!read("js/api.js").includes("SUPABASE_ANON_KEY"));
  assert.ok(!read("js/admin.js").includes('.from("courses")'));
  assert.ok(!read("admin.html").includes("@supabase/supabase-js"));
  for (const tool of ["tools/otp-doctor.html", "tools/profile-doctor.html"]) {
    const source = read(tool);
    assert.ok(source.includes("/api/functions/"));
    assert.ok(!source.includes("supabase.co/functions/v1"));
    assert.ok(!source.includes("SUPABASE_ANON_KEY"));
  }
  const otpDoctor = read("tools/otp-doctor.html");
  assert.ok(otpDoctor.includes('"send-otp": "/api/functions/send-otp"'));
  assert.ok(otpDoctor.includes('"otp-verify": "/api/functions/otp-verify"'));
  assert.ok(!otpDoctor.includes("/api/functions/${encodeURIComponent"));
});

test("self-hosted Compose wires runtime config and keeps public ingress outside the stack", () => {
  const envExample = read(".env.example");
  const compose = read("deploy/self-hosted/compose.yaml");
  const requiredVariables = [
    "DATABASE_URL",
    "STORAGE_SIGNING_SECRET",
    "ZARINPAL_MERCHANT_ID",
    "ZARINPAL_SANDBOX",
    "ZARINPAL_CALLBACK_URL",
    "PRICE_TO_RIAL_FACTOR",
    "SMS_IR_API_KEY",
    "SMS_IR_TEMPLATE_ID",
    "SMS_IR_LINE_NUMBER",
    "SMS_IR_OTP_PARAMETER",
    "KAVENEGAR_API_KEY",
    "OTP_COOLDOWN_SECONDS",
    "OTP_DEBUG",
  ];

  for (const name of requiredVariables) {
    assert.ok(envExample.includes(`${name}=`), `.env.example must document ${name}`);
    assert.ok(compose.includes(`${name}:`), `Compose must pass ${name} to Next`);
  }
  for (const name of ["SMSIR_API_KEY", "SMSIR_TEMPLATE_ID", "SMSIR_LINE_NUMBER", "SMSIR_OTP_PARAMETER"]) {
    assert.ok(compose.includes(`${name}:`), `Compose must preserve alias ${name}`);
  }

  const starter = read("deploy/self-hosted/start.sh");
  const bootstrap = read("deploy/self-hosted/bootstrap-ubuntu.sh");
  assert.ok(!envExample.includes("PUBLIC_DOMAINS="));
  assert.ok(!/^\s*caddy:/mi.test(compose));
  assert.ok(!compose.includes('"80:80"'));
  assert.ok(!compose.includes('"443:443"'));
  assert.ok(compose.includes('"127.0.0.1:8080:80"'));
  assert.ok(!starter.includes("ENABLE_PUBLIC_TLS"));
  assert.ok(starter.includes("--env-file \"$ENV_FILE\""));
  assert.ok(starter.includes("--wait-timeout 300"));
  assert.ok(starter.includes("http://127.0.0.1:8080"));
  assert.ok(!bootstrap.includes("ENABLE_PUBLIC_TLS"));
  assert.ok(bootstrap.includes('VERSION_ID:-}" != 24.04'));
  assert.ok(bootstrap.includes("docker-compose-plugin"));
  assert.ok(bootstrap.includes('"$ROOT_DIR/deploy/self-hosted/start.sh"'));
});
