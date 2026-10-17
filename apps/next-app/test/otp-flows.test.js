import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";
import { POST as sendOtp } from "../app/api/functions/send-otp/route.js";
import { POST as verifyOtp } from "../app/api/functions/otp-verify/route.js";
import {
  installPostgresPoolForTests,
  resetPostgresPoolForTests,
} from "../lib/postgres.js";

const envKeys = [
  "DATABASE_URL", "SMS_IR_API_KEY", "SMSIR_API_KEY", "SMS_IR_TEMPLATE_ID", "SMSIR_TEMPLATE_ID",
  "SMS_IR_LINE_NUMBER", "SMSIR_LINE_NUMBER", "SMS_IR_OTP_PARAMETER", "SMSIR_OTP_PARAMETER",
  "KAVENEGAR_API_KEY", "OTP_DEBUG", "OTP_COOLDOWN_SECONDS", "NODE_ENV",
];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const otpState = { row: null };

function setTestEnv(extra = {}) {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
  for (const key of envKeys.slice(1)) delete process.env[key];
  process.env.NODE_ENV = "test";
  Object.assign(process.env, extra);
}

function resetOtp() {
  otpState.row = null;
}

function hash(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function call(handler, body) {
  return handler(new Request("http://localhost/api/functions/otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function installOtpMock({ smsResponse } = {}) {
  const requests = [];
  const queries = [];
  const runQuery = async (text, values = []) => {
    queries.push({ text, values });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text.trim())) return { rows: [], rowCount: 0 };
    if (text.includes("pg_advisory_xact_lock")) return { rows: [{}], rowCount: 1 };
    if (text.includes("SELECT created_at FROM public.otp_codes")) {
      return { rows: otpState.row ? [{ created_at: otpState.row.created_at }] : [], rowCount: otpState.row ? 1 : 0 };
    }
    if (text.includes("SELECT id, code_hash, attempts")) {
      if (!otpState.row) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          ...otpState.row,
          expired: new Date(otpState.row.expires_at).getTime() < Date.now(),
        }],
        rowCount: 1,
      };
    }
    if (text.startsWith("DELETE FROM public.otp_codes") && text.includes("phone = $1")) {
      if (otpState.row?.phone === values[0] && otpState.row?.purpose === values[1]) otpState.row = null;
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("DELETE FROM public.otp_codes") && text.includes("id = $1")) {
      if (otpState.row?.id === values[0]) otpState.row = null;
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("INSERT INTO public.otp_codes")) {
      otpState.row = {
        id: "otp-1",
        phone: values[0],
        code_hash: values[1],
        purpose: values[2],
        expires_at: values[3],
        attempts: 0,
        created_at: new Date(),
      };
      return { rows: [{ id: otpState.row.id }], rowCount: 1 };
    }
    if (text.startsWith("UPDATE public.otp_codes SET attempts")) {
      if (otpState.row?.id === values[0]) otpState.row.attempts = (otpState.row.attempts ?? 0) + 1;
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  };

  const currentNodeEnv = process.env.NODE_ENV;
  if (currentNodeEnv === "production") process.env.NODE_ENV = "test";
  try {
    installPostgresPoolForTests({
      query: runQuery,
      async connect() {
        return { query: runQuery, release() {} };
      },
    });
  } finally {
    if (currentNodeEnv === "production") process.env.NODE_ENV = currentNodeEnv;
  }

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    requests.push({ url, method, init });

    if (url.hostname === "api.sms.ir") {
      if (typeof smsResponse === "function") return smsResponse(url, init);
      return Response.json(smsResponse ?? { status: 1, message: "موفق", data: { messageId: 42 } });
    }
    if (url.hostname === "api.kavenegar.com") {
      return Response.json({ return: { status: 200, message: "ok" } });
    }
    throw new Error(`Unexpected external request: ${method} ${url}`);
  };
  return { requests, queries };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  const currentNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  resetPostgresPoolForTests();
  if (currentNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = currentNodeEnv;
  resetOtp();
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

test("send-otp normalizes the phone, stores only a code hash in PostgreSQL, enforces cooldown, and verify consumes the OTP", async () => {
  setTestEnv();
  const { queries } = installOtpMock();

  const sent = await call(sendOtp, { phone: "09121351047" });
  const sentBody = await sent.json();
  assert.equal(sent.status, 200);
  assert.equal(sentBody.success, true);
  assert.equal(sentBody.dev_mode, true);
  assert.match(sentBody.debug_code, /^\d{6}$/);
  assert.equal(sentBody.expires_in, 120);
  assert.equal(otpState.row.phone, "989121351047");
  assert.equal(otpState.row.code_hash, hash(sentBody.debug_code));
  assert.notEqual(otpState.row.code_hash, sentBody.debug_code);

  const cooldown = await call(sendOtp, { phone: "09121351047" });
  assert.equal(cooldown.status, 429);
  assert.equal((await cooldown.json()).cooldown, true);
  assert.ok(queries.some((query) => query.text.includes("pg_advisory_xact_lock")));

  const verified = await call(verifyOtp, {
    phone: "09121351047",
    code: sentBody.debug_code,
    purpose: "register",
  });
  assert.equal(verified.status, 200);
  assert.deepEqual(await verified.json(), {
    success: true,
    phone: "989121351047",
    purpose: "register",
    message: "کد تایید شد",
  });
  assert.equal(otpState.row, null);
});

test("send-otp uses sms.ir Verify and never exposes the code when SMS succeeds", async () => {
  setTestEnv({ SMS_IR_API_KEY: "test-smsir-key", SMS_IR_TEMPLATE_ID: "123456" });
  const { requests } = installOtpMock();

  const response = await call(sendOtp, { phone: "09121351047" });
  const body = await response.json();
  const sms = requests.find((request) => request.url.hostname === "api.sms.ir");
  const smsBody = JSON.parse(sms.init.body);

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.provider, "smsir");
  assert.equal(body.sms_mode, "verify");
  assert.equal(body.message_id, 42);
  assert.equal(body.debug_code, undefined);
  assert.equal(smsBody.mobile, "9121351047");
  assert.equal(smsBody.templateId, 123456);
  assert.equal(smsBody.parameters[0].name, "CODE");
  assert.match(smsBody.parameters[0].value, /^\d{6}$/);
  assert.equal(otpState.row.code_hash, hash(smsBody.parameters[0].value));
  assert.equal(new Headers(sms.init.headers).get("x-api-key"), "test-smsir-key");
});

test("send-otp removes the failed OTP by its id after an SMS provider error so the user can retry", async () => {
  setTestEnv({ SMS_IR_API_KEY: "test-smsir-key", SMS_IR_TEMPLATE_ID: "123456" });
  const { queries } = installOtpMock({ smsResponse: { status: 113, message: "قالب یافت نشد", data: null } });

  const response = await call(sendOtp, { phone: "09121351047" });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.sms_failed, true);
  assert.equal(body.sms_status, 113);
  assert.match(body.error, /قالب/);
  assert.equal(otpState.row, null);
  assert.ok(queries.some((query) => query.text.includes("DELETE FROM public.otp_codes WHERE id = $1")));
});

test("send-otp fails closed in production when no SMS provider is configured", async () => {
  setTestEnv({ NODE_ENV: "production", OTP_DEBUG: "true" });
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    throw new Error("production OTP without SMS must not call a provider");
  };

  const response = await call(sendOtp, { phone: "09121351047" });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.sms_config_missing, true);
  assert.equal(body.debug_code, undefined);
  assert.equal(fetchCount, 0);
});

test("send-otp never exposes debug_code in production even when OTP_DEBUG is enabled", async () => {
  setTestEnv({
    NODE_ENV: "production",
    OTP_DEBUG: "true",
    SMS_IR_API_KEY: "test-smsir-key",
    SMS_IR_TEMPLATE_ID: "123456",
  });
  installOtpMock();

  const response = await call(sendOtp, { phone: "09121351047" });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.sent_via_sms, true);
  assert.equal(body.debug_code, undefined);
});

test("otp-verify rejects missing, wrong, expired and over-attempt codes", async () => {
  setTestEnv();
  installOtpMock();

  const missing = await call(verifyOtp, { phone: "09121351047", purpose: "register" });
  assert.equal(missing.status, 400);
  assert.deepEqual(await missing.json(), { error: "اطلاعات ناقص است" });

  otpState.row = {
    id: "otp-1", phone: "989121351047", purpose: "register", code_hash: hash("123456"),
    attempts: 0, expires_at: new Date("2099-01-01T00:00:00.000Z"), created_at: new Date(),
  };
  const wrong = await call(verifyOtp, { phone: "09121351047", code: "000000", purpose: "register" });
  assert.equal(wrong.status, 400);
  assert.deepEqual(await wrong.json(), { error: "کد اشتباه است" });
  assert.equal(otpState.row.attempts, 1);

  otpState.row.expires_at = new Date("2000-01-01T00:00:00.000Z");
  const expired = await call(verifyOtp, { phone: "09121351047", code: "123456", purpose: "register" });
  assert.equal(expired.status, 400);
  assert.deepEqual(await expired.json(), { error: "کد منقضی شده است" });

  otpState.row.attempts = 5;
  const locked = await call(verifyOtp, { phone: "09121351047", code: "123456", purpose: "register" });
  assert.equal(locked.status, 429);
  assert.deepEqual(await locked.json(), { error: "تعداد تلاش زیاد است" });
  assert.equal(otpState.row, null);
});
