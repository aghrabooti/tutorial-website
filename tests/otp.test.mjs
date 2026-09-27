// تست‌های مسیر کد تایید پیامکی (send-otp / otp-verify)
//
// چه چیزی را ثابت می‌کند:
//   ۱) حالت توسعه: وقتی نه SMSIR_API_KEY و نه KAVENEGAR_API_KEY تنظیم نشده،
//      پیامکی ارسال نمی‌شود و کد در پاسخ برمی‌گردد (تا بدانیم چرا کاربر پیامک
//      نمی‌گیرد)
//   ۱.۵) مسیر sms.ir: قالب (Verify) و خط اختصاصی (Bulk)، کدهای خطای پنل،
//      فرمت شماره و OTP_DEBUG
//   ۲) قفل ۶۰ ثانیه‌ای: درخواست دوم فوری → 429 با شمارش ثانیه‌ها
//   ۳) بعد از پایان قفل → ارسال موفق
//   ۴) اگر پنل پیامکی خطا بدهد → خطا برمی‌گردد و شماره قفل نمی‌ماند
//   ۵) کد درست پذیرفته و کد غلط رد می‌شود
//
// اجرا:  node otp.test.mjs   (بعد از node build.mjs)
import { readFileSync } from "node:fs";
import path from "node:path";

process.env.TZ = "UTC";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "..");

let failed = 0;
let passed = 0;

function check(label, ok, extra = "") {
    if (ok) {
        passed++;
        console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
    } else {
        failed++;
        console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
    }
}

const read = (rel) => readFileSync(path.join(root, rel), "utf8");

async function loadPair(env, tag) {
    globalThis.__ENV = env;
    const send = await import(`./.build/send-otp.mjs?t=${tag}`);
    const sendHandler = globalThis.__handler;
    const verify = await import(`./.build/verify-otp.mjs?t=${tag}-v`);
    const verifyHandler = globalThis.__handler;
    return { sendHandler, verifyHandler };
}

const call = async (handler, body) => {
    const res = await handler(new Request("http://x/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
};

const PHONE = "09121351047";
const NORMALIZED = "989121351047";

/* ═══════════════════════════════════════════════════════════════
   ۱) حالت توسعه — بدون کلید پیامک
   ═══════════════════════════════════════════════════════════════ */

console.log("── حالت توسعه (کلید پیامک تنظیم نشده) ──");

{
    const { DB } = await import("./supabase-stub.js");
    for (const k of Object.keys(DB)) DB[k] = [];

    const { sendHandler } = await loadPair({ SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k" }, "dev");

    const first = await call(sendHandler, { phone: PHONE });

    check("درخواست اول قبول می‌شود", first.status === 200 && first.body.success === true);
    check("پرچم «پیامک تنظیم نشده» برمی‌گردد", first.body.sms_configured === false);
    check("حالت توسعه اعلام می‌شود", first.body.dev_mode === true);
    check("کد در پاسخ هست (چون پیامکی ارسال نشده)", /^\d{6}$/.test(first.body.debug_code ?? ""),
        first.body.debug_code);
    check("مدت اعتبار کد اعلام می‌شود", first.body.expires_in === 120, String(first.body.expires_in));
    check("ردیف کد در دیتابیس ساخته شد", DB.otp_codes.length === 1);
    check("کد به‌صورت هش ذخیره می‌شود (نه متن ساده)",
        !!DB.otp_codes[0]?.code_hash && DB.otp_codes[0].code_hash !== first.body.debug_code);

    /* ── ۲) قفل ۶۰ ثانیه‌ای ── */
    const second = await call(sendHandler, { phone: PHONE });

    check("درخواست فوری دوم رد می‌شود (429)", second.status === 429, String(second.status));
    check("پرچم cooldown برمی‌گردد", second.body.cooldown === true);
    check("تعداد ثانیه‌های باقی‌مانده اعلام می‌شود",
        Number(second.body.retry_after) > 0 && Number(second.body.retry_after) <= 60,
        String(second.body.retry_after));
    check("پیام خطا شامل عدد ثانیه است", /\d/.test(second.body.error ?? ""), second.body.error);

    /* ── ۳) بعد از پایان قفل ── */
    DB.otp_codes[0].created_at = new Date(Date.now() - 61_000).toISOString();

    const third = await call(sendHandler, { phone: PHONE });
    check("بعد از ۶۰ ثانیه دوباره ارسال می‌شود", third.status === 200 && third.body.success === true);
    check("کد قبلی پاک و کد تازه ساخته شد", DB.otp_codes.length === 1);

    /* ── ۵) بررسی کد ── */
    const { verifyHandler } = await loadPair(
        { SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k" }, "dev2"
    );

    const wrong = await call(verifyHandler, { phone: PHONE, code: "000000", purpose: "register" });
    check("کد اشتباه رد می‌شود", wrong.body.success !== true, JSON.stringify(wrong.body).slice(0, 80));

    const right = await call(verifyHandler, {
        phone: PHONE, code: third.body.debug_code, purpose: "register",
    });
    check("کد درست پذیرفته می‌شود", right.body.success === true, JSON.stringify(right.body).slice(0, 100));
}

/* ═══════════════════════════════════════════════════════════════
   ۴) حالت واقعی پیامک — موفق و ناموفق
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── حالت واقعی پیامک ──");

{
    const { DB } = await import("./supabase-stub.js");
    for (const k of Object.keys(DB)) DB[k] = [];

    const ENV = {
        SUPABASE_URL: "http://x",
        SUPABASE_SERVICE_ROLE_KEY: "k",
        KAVENEGAR_API_KEY: "test-key",
    };

    const realFetch = globalThis.fetch;
    let kaveSeen = null;

    // ── پیامک موفق ──
    globalThis.fetch = async (url, init) => {
        kaveSeen = { url: String(url), body: String(init?.body ?? "") };
        return new Response(
            JSON.stringify({ return: { status: 200, message: "ok" } }),
            { status: 200, headers: { "content-type": "application/json" } }
        );
    };

    const { sendHandler } = await loadPair(ENV, "sms-ok");
    const ok = await call(sendHandler, { phone: PHONE });

    check("با کلید پیامک، ارسال موفق است", ok.status === 200 && ok.body.success === true);
    check("پرچم sent_via_sms برمی‌گردد", ok.body.sent_via_sms === true);
    check("کد دیگر در پاسخ افشا نمی‌شود (امنیت)", ok.body.debug_code === undefined);
    check("پیامک به فرمت درست شماره ارسال شد",
        kaveSeen?.body.includes("receptor=09121351047"), kaveSeen?.body?.slice(0, 60));

    // ── پیامک ناموفق ──
    for (const k of Object.keys(DB)) DB[k] = [];
    globalThis.fetch = async () => new Response(
        JSON.stringify({ return: { status: 424, message: "credit is not enough" } }),
        { status: 200, headers: { "content-type": "application/json" } }
    );

    const { sendHandler: failing } = await loadPair(ENV, "sms-fail");
    const bad = await call(failing, { phone: PHONE });

    check("خطای پنل پیامکی به کاربر اعلام می‌شود", bad.status === 502 && bad.body.sms_failed === true,
        bad.body.error);
    check("پیام خطا راهنمای بررسی اعتبار/خط است", /اعتبار|خط/.test(bad.body.error ?? ""));
    check("شماره قفل نمی‌ماند (ردیف کد پاک شد)", DB.otp_codes.length === 0,
        `${DB.otp_codes.length} ردیف`);

    // بعد از خطا باید فوراً بتوان دوباره تلاش کرد
    globalThis.fetch = async () => new Response(
        JSON.stringify({ return: { status: 200 } }),
        { status: 200, headers: { "content-type": "application/json" } }
    );

    const retry = await call(failing, { phone: PHONE });
    check("بعد از خطای پیامک، تلاش دوباره فوراً ممکن است", retry.status === 200 && retry.body.success === true);

    // فاصله‌ی مجاز قابل تنظیم است
    for (const k of Object.keys(DB)) DB[k] = [];
    const { sendHandler: custom } = await loadPair({ ...ENV, OTP_COOLDOWN_SECONDS: "5" }, "cooldown");
    await call(custom, { phone: PHONE });
    const quick = await call(custom, { phone: PHONE });

    check("فاصله‌ی مجاز از سکرت قابل تنظیم است (۵ ثانیه)",
        quick.status === 429 && Number(quick.body.retry_after) <= 5, String(quick.body.retry_after));

    globalThis.fetch = realFetch;
}

/* ═══════════════════════════════════════════════════════════════
   ۷) مسیر sms.ir — ارسال سریع (Verify)
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── sms.ir: ارسال سریع (قالب / Verify) ──");

{
    const { DB } = await import("./supabase-stub.js");
    const ENV = {
        SUPABASE_URL: "http://x",
        SUPABASE_SERVICE_ROLE_KEY: "k",
        SMSIR_API_KEY: "test-smsir-key",
        SMSIR_TEMPLATE_ID: "123456",
    };

    const realFetch = globalThis.fetch;

    // ── ارسال موفق ──
    let seen = null;

    const mockSmsIr = (payload, httpStatus = 200) => async (url, init) => {
        seen = {
            url: String(url),
            headers: init?.headers ?? {},
            body: JSON.parse(init?.body ?? "{}"),
        };
        return new Response(JSON.stringify(payload), {
            status: httpStatus,
            headers: { "content-type": "application/json" },
        });
    };

    const successPayload = {
        status: 1,
        message: "موفق",
        data: { messageId: 555444333, cost: 1.0 },
    };

    for (const k of Object.keys(DB)) DB[k] = [];
    globalThis.fetch = mockSmsIr(successPayload);

    const { sendHandler } = await loadPair(ENV, "smsir-ok");
    const ok = await call(sendHandler, { phone: PHONE });

    check("sms.ir: ارسال موفق است", ok.status === 200 && ok.body.success === true,
        JSON.stringify(ok.body).slice(0, 120));
    check("sms.ir: نام سامانه در پاسخ می‌آید", ok.body.provider === "smsir", ok.body.provider);
    check("sms.ir: روش ارسال (قالب) اعلام می‌شود", ok.body.sms_mode === "verify");
    check("sms.ir: شناسه‌ی پیام برگردانده می‌شود", ok.body.message_id === 555444333);
    check("sms.ir: کد در پاسخ افشا نمی‌شود", ok.body.debug_code === undefined);
    check("sms.ir: آدرس درست فراخوانی شد",
        seen?.url === "https://api.sms.ir/v1/send/verify", seen?.url);
    check("sms.ir: کلید در هدر x-api-key فرستاده می‌شود",
        seen?.headers?.["x-api-key"] === "test-smsir-key");
    check("sms.ir: شماره بدون صفر فرستاده می‌شود",
        seen?.body?.mobile === "9121351047", seen?.body?.mobile);
    check("sms.ir: شناسه‌ی قالب عددی فرستاده می‌شود",
        seen?.body?.templateId === 123456, String(seen?.body?.templateId));
    check("sms.ir: پارامتر قالب «CODE» است",
        seen?.body?.parameters?.[0]?.name === "CODE", JSON.stringify(seen?.body?.parameters));
    check("sms.ir: مقدار پارامتر، همان کد ۶ رقمی است",
        /^\d{6}$/.test(seen?.body?.parameters?.[0]?.value ?? ""),
        seen?.body?.parameters?.[0]?.value);
    check("sms.ir: کد به‌صورت هش در دیتابیس ذخیره شد",
        DB.otp_codes.length === 1 &&
        DB.otp_codes[0].code_hash !== seen?.body?.parameters?.[0]?.value);

    // ── همان تست با نام‌گذاری SMS_IR_… (سکرت‌های واقعی سایت) ──
    for (const k of Object.keys(DB)) DB[k] = [];
    globalThis.fetch = mockSmsIr(successPayload);

    const { sendHandler: underscore } = await loadPair(
        {
            SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k",
            SMS_IR_API_KEY: "test-smsir-key", SMS_IR_TEMPLATE_ID: "123456",
        },
        "smsir-underscore"
    );
    const us = await call(underscore, { phone: PHONE });

    check("نام‌گذاری SMS_IR_API_KEY / SMS_IR_TEMPLATE_ID هم کار می‌کند",
        us.status === 200 && us.body.success === true && us.body.provider === "smsir",
        JSON.stringify(us.body).slice(0, 100));
    check("با نام‌گذاری SMS_IR_… هم کلید در هدر درست می‌رود",
        seen?.headers?.["x-api-key"] === "test-smsir-key");
    check("با نام‌گذاری SMS_IR_… هم شناسه‌ی قالب درست می‌رود",
        seen?.body?.templateId === 123456, String(seen?.body?.templateId));

    // ── خط اختصاصی با نام‌گذاری SMS_IR_LINE_NUMBER ──
    for (const k of Object.keys(DB)) DB[k] = [];
    globalThis.fetch = mockSmsIr({ status: 1, message: "موفق", data: { packId: 1, messageIds: [2] } });

    const { sendHandler: lineUnderscore } = await loadPair(
        {
            SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k",
            SMS_IR_API_KEY: "test-smsir-key", SMS_IR_LINE_NUMBER: "30004505000017",
        },
        "smsir-line-underscore"
    );
    const lu = await call(lineUnderscore, { phone: PHONE });

    check("نام‌گذاری SMS_IR_LINE_NUMBER هم Bulk را فعال می‌کند",
        lu.status === 200 && lu.body.sms_mode === "bulk", lu.body.sms_mode);

    // ── نام پارامتر قابل تغییر است ──
    for (const k of Object.keys(DB)) DB[k] = [];
    const { sendHandler: customParam } = await loadPair(
        { ...ENV, SMSIR_OTP_PARAMETER: "#OTP#" }, "smsir-param"
    );
    await call(customParam, { phone: PHONE });

    check("sms.ir: نام پارامتر از سکرت خوانده می‌شود (بدون #)",
        seen?.body?.parameters?.[0]?.name === "OTP", seen?.body?.parameters?.[0]?.name);

    // ── خطای پنل: قالب پیدا نشد (کد ۱۱۳) ──
    for (const k of Object.keys(DB)) DB[k] = [];
    globalThis.fetch = mockSmsIr({ status: 113, message: "قالب یافت نشد", data: null });

    const { sendHandler: failing } = await loadPair(ENV, "smsir-113");
    const bad = await call(failing, { phone: PHONE });

    check("sms.ir: خطای پنل به کاربر اعلام می‌شود", bad.status === 502 && bad.body.sms_failed === true);
    check("sms.ir: کد وضعیت پنل برگردانده می‌شود", bad.body.sms_status === 113);
    check("sms.ir: پیام خطا شامل راهنمای قالب است", /قالب/.test(bad.body.error ?? ""), bad.body.error);
    check("sms.ir: بعد از خطا شماره قفل نمی‌ماند", DB.otp_codes.length === 0);

    // ── فرمت شماره: اگر ۱۰۴ داد، با صفر ابتدایی دوباره تلاش می‌کند ──
    for (const k of Object.keys(DB)) DB[k] = [];
    const attempts = [];
    globalThis.fetch = async (url, init) => {
        const body = JSON.parse(init?.body ?? "{}");
        attempts.push(body.mobile);
        const payload = attempts.length === 1
            ? { status: 104, message: "درخواست شما دارای موبایل(های) نادرست است" }
            : successPayload;
        return new Response(JSON.stringify(payload), {
            status: 200, headers: { "content-type": "application/json" },
        });
    };

    const { sendHandler: retryFmt } = await loadPair(ENV, "smsir-104");
    const fmt = await call(retryFmt, { phone: PHONE });

    check("sms.ir: با کد ۱۰۴ دوباره با فرمت ۰۹ تلاش می‌شود",
        fmt.status === 200 && attempts.length === 2, attempts.join(" → "));
    check("sms.ir: تلاش دوم با ۰۹۱۲… فرستاده شد", attempts[1] === "09121351047", attempts[1]);

    // ── OTP_DEBUG برای تست با کلید Sandbox ──
    for (const k of Object.keys(DB)) DB[k] = [];
    globalThis.fetch = mockSmsIr(successPayload);

    const { sendHandler: debugOn } = await loadPair({ ...ENV, OTP_DEBUG: "true" }, "smsir-debug");
    const dbg = await call(debugOn, { phone: PHONE });

    check("sms.ir: با OTP_DEBUG کد در پاسخ می‌آید", /^\d{6}$/.test(dbg.body.debug_code ?? ""),
        dbg.body.debug_code);
    check("sms.ir: هشدار روشن‌بودن OTP_DEBUG داده می‌شود",
        /OTP_DEBUG/.test(dbg.body.warning ?? ""));

    // ── سکرت ناقص: کلید هست ولی قالب/خط تنظیم نشده ──
    for (const k of Object.keys(DB)) DB[k] = [];
    const { sendHandler: incomplete } = await loadPair(
        { SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k", SMSIR_API_KEY: "k" },
        "smsir-incomplete"
    );
    const inc = await call(incomplete, { phone: PHONE });

    check("sms.ir: سکرت ناقص → خطای واضح", inc.status === 502 && inc.body.sms_config_missing === true);
    check("sms.ir: نام سکرت ناقص گفته می‌شود",
        /SMS_IR_TEMPLATE_ID/.test(inc.body.error ?? ""), inc.body.error);
    check("sms.ir: نام دقیق سکرت ناقص در پاسخ می‌آید",
        inc.body.missing_secret === "SMS_IR_TEMPLATE_ID", inc.body.missing_secret);
    check("sms.ir: در این حالت هم شماره قفل نمی‌ماند", DB.otp_codes.length === 0);

    // ── ارسال با خط اختصاصی (Bulk) وقتی قالبی وجود ندارد ──
    for (const k of Object.keys(DB)) DB[k] = [];
    globalThis.fetch = mockSmsIr({ status: 1, message: "موفق", data: { packId: 987, messageIds: [11] } });

    const { sendHandler: bulk } = await loadPair(
        {
            SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k",
            SMSIR_API_KEY: "test-smsir-key", SMSIR_LINE_NUMBER: "30004505000017",
        },
        "smsir-bulk"
    );
    const bulkRes = await call(bulk, { phone: PHONE });

    check("sms.ir: بدون قالب، ارسال با خط اختصاصی انجام می‌شود",
        bulkRes.status === 200 && bulkRes.body.sms_mode === "bulk", bulkRes.body.sms_mode);
    check("sms.ir: آدرس Bulk درست است",
        seen?.url === "https://api.sms.ir/v1/send/bulk", seen?.url);
    check("sms.ir: شماره خط عددی فرستاده می‌شود",
        seen?.body?.lineNumber === 30004505000017, String(seen?.body?.lineNumber));
    check("sms.ir: متن پیامک شامل کد تأیید است",
        /کد تأیید/.test(seen?.body?.messageText ?? "") &&
        /\d{6}/.test(seen?.body?.messageText ?? ""), seen?.body?.messageText);

    // ── اولویت: اگر هر دو سامانه تنظیم باشند، sms.ir برنده است ──
    for (const k of Object.keys(DB)) DB[k] = [];
    globalThis.fetch = mockSmsIr(successPayload);

    const { sendHandler: both } = await loadPair({ ...ENV, KAVENEGAR_API_KEY: "kave" }, "both");

    let calledUrl = null;
    const spy = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        calledUrl = String(url);
        return spy(url, init);
    };

    const bothRes = await call(both, { phone: PHONE });

    check("هر دو سکرت → اولویت با sms.ir است",
        bothRes.body.provider === "smsir" && String(calledUrl).includes("api.sms.ir"), calledUrl);

    globalThis.fetch = realFetch;
}

/* ═══════════════════════════════════════════════════════════════
   ۶) فرم ثبت‌نام سایت
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── فرم ثبت‌نام: رفتار در برابر خطاها ──");

const registerJs = read("js/register.js");

check("شمارش معکوس وجود دارد", registerJs.includes("startCooldown"));
check("روی دکمه شمارش ثانیه‌ها نوشته می‌شود", registerJs.includes("ارسال دوباره تا"));
check("پاسخ cooldown/retry_after مدیریت می‌شود",
    registerJs.includes("result.retry_after") && registerJs.includes("result.cooldown"));
check("حالت توسعه به کاربر گفته می‌شود",
    registerJs.includes("sms_configured") && registerJs.includes("پیامک ارسال نشد") === false
        ? registerJs.includes("سامانه‌ی پیامک تنظیم نشده") : true);
check("نام فانکشن تایید کد همان otp-verify است", registerJs.includes('"otp-verify"'));
check("پیام خطای پنل پیامکی نمایش داده می‌شود", registerJs.includes("result.error"));

console.log("\n── ابزار دکتر پیامک ──");

const doctor = read("tools/otp-doctor.html");

check("ابزار دکتر پیامک وجود دارد", doctor.length > 1000);
check("همان فانکشن send-otp را صدا می‌زند", doctor.includes('callFunction("send-otp"'));
check("کد را با otp-verify بررسی می‌کند", doctor.includes('callFunction("otp-verify"'));
check("پیام حالت توسعه را تشخیص می‌دهد", doctor.includes("sms_configured"));
check("قفل ۶۰ ثانیه‌ای را تشخیص می‌دهد", doctor.includes("retry_after"));
check("خطای پنل پیامکی را تشخیص می‌دهد", doctor.includes("sms_failed"));
check("SQL پاک‌کردن قفل را می‌سازد", doctor.includes("delete from public.otp_codes"));
check("مسیر تنظیم سکرت sms.ir را توضیح می‌دهد",
    doctor.includes("SMS_IR_API_KEY") && doctor.includes("SMS_IR_TEMPLATE_ID") &&
    doctor.includes("SMSIR_API_KEY") && doctor.includes("SMSIR_TEMPLATE_ID") &&
    doctor.includes("Secrets"));
check("مسیر ساخت قالب در پنل sms.ir را توضیح می‌دهد",
    doctor.includes("#CODE#") && doctor.includes("ارسال سریع"));
check("راهنمای ارسال با خط اختصاصی (Bulk) را هم دارد",
    doctor.includes("SMS_IR_LINE_NUMBER"));
check("نام سکرت ناقص را در تشخیص نشان می‌دهد", doctor.includes("missing_secret"));
check("کد وضعیت پنل را در تشخیص نشان می‌دهد", doctor.includes("sms_status"));
check("about Kavenegar still documented as fallback",
    doctor.includes("KAVENEGAR_API_KEY"));
check("فقط به فانکشن زنده وصل می‌شود (بدون ذخیره‌ی چیزی)",
    !doctor.includes("localStorage") && !doctor.includes("supabase.co/rest"));

console.log("\n── فایل ابزار در سرور ──");

const serve = read("tools/serve.py");
check("سرور مسیر /otp-doctor را می‌شناسد", serve.includes("/otp-doctor"));
check("لینک ابزار در صفحه‌ی دانلود هست", serve.includes('href="/otp-doctor"'));
check("صفحه‌ی «گذاشتن کد روی سرور» وجود دارد", serve.includes("/deploy"));
check("همان فایل send-otp را برای کپی می‌خواند",
    serve.includes('supabase/functions/send-otp/index.ts'));
check("انگشت‌نگاشت نسخه (sha256) را نشان می‌دهد", serve.includes("hashlib.sha256"));
check("فایل خام .ts هم قابل دانلود است", serve.includes("/send-otp.ts"));

/* ═══════════════════════════════════════════════════════════════ */

console.log(`\n${failed === 0 ? "ALL OTP CHECKS PASSED ✅" : `${failed} تست شکست خورد ❌`}`);
console.log(`(${passed} تست موفق)`);
process.exit(failed === 0 ? 0 : 1);
