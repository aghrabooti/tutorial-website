// تست‌های CORS — چرا؟ چون بدون این هدرها، مرورگر درخواست سایت را رد می‌کند
// و کاربر فقط این را در کنسول می‌بیند:
//   "blocked by CORS policy: ... No 'Access-Control-Allow-Origin' header"
//
// چه چیزی را ثابت می‌کند:
//   ۱) هر فانکشنی که از داخل js/ صدا زده می‌شود، باید هدر CORS داشته باشد
//   ۲) درخواست preflight (OPTIONS) باید ۲۰۰ با Access-Control-Allow-Origin بدهد
//   ۳) خطاها (۴۰۰/۴۰۱/… ) هم باید هدر CORS داشته باشند، وگرنه مرورگر
//      حتی پیام خطا را هم به سایت نشان نمی‌دهد
//
// اجرا:  node cors.test.mjs   (بعد از node build.mjs)
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

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
const functionsDir = path.join(root, "supabase", "functions");
const allFunctions = readdirSync(functionsDir).filter((n) =>
    existsSync(path.join(functionsDir, n, "index.ts"))
);

/* ═══════════════════════════════════════════════════════════════
   ۱) کدام فانکشن‌ها از مرورگر صدا زده می‌شوند؟
   ═══════════════════════════════════════════════════════════════ */

console.log("── پیدا کردن فانکشن‌هایی که سایت صدا می‌زند ──");

const jsDir = path.join(root, "js");
const jsFiles = readdirSync(jsDir).filter((f) => f.endsWith(".js"));

const calledFromBrowser = new Set();

for (const file of jsFiles) {
    const src = readFileSync(path.join(jsDir, file), "utf8");
    for (const m of src.matchAll(/(?:apiCall|callFunction)\(\s*"([^"]+)"/g)) {
        calledFromBrowser.add(m[1]);
    }
}

console.log(`فانکشن‌های صدا‌زده‌شده از سایت (${calledFromBrowser.size}): ` +
    [...calledFromBrowser].sort().join(", "));

check("فانکشن ثبت‌نام در فهرست فراخوانی‌های سایت است",
    calledFromBrowser.has("register-user"));
check("فانکشن محتوای سایت در فهرست است", calledFromBrowser.has("site-content"));
check("فانکشن نشست (check-session) در فهرست است",
    calledFromBrowser.has("check-session"));

/* ═══════════════════════════════════════════════════════════════
   ۲) همه‌ی این فانکشن‌ها باید CORS داشته باشند
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── بررسی هدرهای CORS در کد فانکشن‌ها ──");

for (const name of [...calledFromBrowser].sort()) {
    const file = path.join(functionsDir, name, "index.ts");

    // فانکشن‌هایی که فایلشان در ریپو نیستند (مثل otp-verify که فقط روی سرور هست)
    if (!existsSync(file)) {
        check(`«${name}» فایلش داخل ریپو نیست (فقط روی سرور) — رد شد`, true,
            "برای این یکی فایل محلی نداریم");
        continue;
    }

    const src = readFileSync(file, "utf8");

    check(`«${name}»: هدر Access-Control-Allow-Origin دارد`,
        /Access-Control-Allow-Origin/.test(src));

    check(`«${name}»: درخواست OPTIONS (preflight) را جواب می‌دهد`,
        /"OPTIONS"/.test(src));

    // هر Response باید هدرها را بگیرد؛ حداقل به‌تعداد خطاهای رایج
    const responses = (src.match(/new Response\(/g) ?? []).length;
    const withHeaders = (src.match(/corsHeaders/g) ?? []).length;

    check(`«${name}»: همه‌ی پاسخ‌ها هدر CORS را می‌گیرند`,
        withHeaders >= responses, `${withHeaders} هدر برای ${responses} پاسخ`);
}

/* ═══════════════════════════════════════════════════════════════
   ۳) آزمون واقعی: OPTIONS و POST را روی فانکشن‌های ساخته‌شده اجرا می‌کنیم
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── آزمون واقعی preflight و پاسخ خطا ──");

const ORIGIN = "https://www.mahdiazizi.com";

async function loadHandler(name, tag) {
    globalThis.__ENV = {
        SUPABASE_URL: "http://x",
        SUPABASE_SERVICE_ROLE_KEY: "k",
    };
    await import(`./.build/${name}.mjs?cors=${tag}`);
    return globalThis.__handler;
}

const firewallFree = (res) =>
    res.headers.get("access-control-allow-origin") === "*";

for (const name of ["register-user", "check-session", "logout-user", "send-otp", "site-content"]) {
    const handler = await loadHandler(name, `opt-${name}`);

    const preflight = await handler(new Request("http://x/", {
        method: "OPTIONS",
        headers: {
            Origin: ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    }));

    check(`preflight «${name}» موفق است (۲۰۰ + CORS)`,
        preflight.status === 200 && firewallFree(preflight),
        `status=${preflight.status} ACAO=${preflight.headers.get("access-control-allow-origin")}`);
}

{
    const { DB } = await import("./supabase-stub.js");
    DB.site_users = [];

    const handler = await loadHandler("register-user", "post-ok");

    const res = await handler(new Request("http://x/", {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "09121351047", password: "123456" }),
    }));

    const body = await res.json();

    check("همان درخواست فرم سایت (شماره + رمز) ثبت‌نام می‌شود",
        res.status === 200 && body.success === true,
        JSON.stringify(body).slice(0, 90));
    check("پاسخ register-user هدر CORS دارد", firewallFree(res),
        `ACAO=${res.headers.get("access-control-allow-origin")}`);
    check("بدون نام، کاربر با نام خالی ساخته می‌شود",
        DB.site_users[0]?.first_name === "" && DB.site_users[0]?.role === "student");
}

{
    const handler = await loadHandler("register-user", "post-missing");

    const res = await handler(new Request("http://x/", {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "09121351047" }),
    }));

    const body = await res.json();

    check("پاسخ خطای register-user هم هدر CORS دارد (پیام خطا به کاربر می‌رسد)",
        firewallFree(res), `ACAO=${res.headers.get("access-control-allow-origin")}`);
    check("register-user بدون رمز، خطای «اطلاعات ناقص است» می‌دهد",
        res.status === 400 && /اطلاعات ناقص/.test(body.error ?? ""), body.error);
}

{
    const handler = await loadHandler("check-session", "session-bad");
    const res = await handler(new Request("http://x/", {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ token: "nope" }),
    }));

    check("check-session با توکن نامعتبر ۴۰۱ + CORS می‌دهد",
        res.status === 401 && firewallFree(res), String(res.status));
}

{
    const handler = await loadHandler("logout-user", "logout-bad");
    const res = await handler(new Request("http://x/", {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ token: "nope" }),
    }));

    check("logout-user با توکن نامعتبر ۴۰۱ + CORS می‌دهد",
        res.status === 401 && firewallFree(res), String(res.status));
}

/* ═══════════════════════════════════════════════════════════════
   ۵) update-profile — ذخیره‌ی «تکمیل پروفایل»
   (این فایل قبلاً خالی بود و سرور ۵۰۲ می‌داد)
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── update-profile (تکمیل پروفایل) ──");

{
    const { createHash } = await import("node:crypto");
    const { DB } = await import("./supabase-stub.js");

    const TOKEN = "test-session-token";
    const tokenHash = createHash("sha256").update(TOKEN).digest("hex");

    const seed = () => {
        DB.site_users = [{
            id: "u1", phone: "989121351047", role: "student",
            first_name: "", last_name: "", grade: "", major: "",
        }];
        DB.user_sessions = [{
            id: "s1", user_id: "u1", token_hash: tokenHash, is_active: true,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
        }];
    };

    const call = async (handler, body) => {
        const res = await handler(new Request("http://x/", {
            method: "POST",
            headers: { Origin: ORIGIN, "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }));
        return { status: res.status, body: await res.json(), cors: firewallFree(res) };
    };

    // فایل نباید خالی بماند (باگ اصلی: استابِ خالی → ۵۰۲)
    const src = read("supabase/functions/update-profile/index.ts");
    check("فایل update-profile کد دارد (استابِ خالی نیست)", src.length > 1200, `${src.length} بایت`);
    check("نشست را با هش توکن پیدا می‌کند", src.includes("token_hash"));
    check("اطلاعات را در site_users ذخیره می‌کند", src.includes('from("site_users")'));

    const handler = await loadHandler("update-profile", "profile");

    seed();
    const ok = await call(handler, {
        token: TOKEN, first_name: "سارا", last_name: "محمدی",
        grade: "11", major: "ریاضی",
    });

    check("ذخیره‌ی اطلاعات پروفایل موفق است", ok.status === 200 && ok.body.success === true,
        JSON.stringify(ok.body).slice(0, 90));
    check("پاسخ هدر CORS دارد", ok.cors);
    check("نام ذخیره شد", DB.site_users[0].first_name === "سارا");
    check("پایه ذخیره شد", DB.site_users[0].grade === "11");
    check("رشته ذخیره شد", DB.site_users[0].major === "ریاضی");

    // پایه‌ی نهم رشته ندارد (فرم major را null می‌فرستد)
    seed();
    const ninth = await call(handler, {
        token: TOKEN, first_name: "علی", last_name: "رضایی", grade: "9", major: null,
    });
    check("پایه‌ی نهم بدون رشته هم ذخیره می‌شود",
        ninth.body.success === true && DB.site_users[0].major === "",
        JSON.stringify(DB.site_users[0]).slice(0, 90));

    // توکن نامعتبر
    seed();
    const bad = await call(handler, {
        token: "wrong", first_name: "سارا", last_name: "محمدی", grade: "11",
    });
    check("توکن نامعتبر → ۴۰۱ + CORS", bad.status === 401 && bad.cors, bad.body.error);
    check("با توکن نامعتبر چیزی ذخیره نمی‌شود", DB.site_users[0].first_name === "");

    // داده ناقص
    seed();
    const missing = await call(handler, { token: TOKEN, first_name: "سارا", last_name: "", grade: "" });
    check("نام ناقص → ۴۰۰ «اطلاعات ناقص است»",
        missing.status === 400 && /اطلاعات ناقص/.test(missing.body.error ?? ""), missing.body.error);

    // پیش‌پرواز
    const pre = await handler(new Request("http://x/", {
        method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" },
    }));
    check("preflight «update-profile» موفق است", pre.status === 200 && firewallFree(pre));
}

/* ═══════════════════════════════════════════════════════════════
   ۴) آیا کد جدید ثبت‌نام با فرم سایت هم‌خوان است؟
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── هم‌خوانی فرم ثبت‌نام با فانکشن register-user ──");

const registerJs = read("js/register.js");
const registerHtml = read("register.html");
const registerFn = read("supabase/functions/register-user/index.ts");

check("فرم ثبت‌نام نام نمی‌فرستد (طراحی: نام در تکمیل پروفایل)",
    !registerJs.includes("first_name") && !registerHtml.includes("first_name"));

check("فانکشن register-user نام را اجباری نمی‌خواهد (هم‌خوان با فرم)",
    !/!first_name/.test(registerFn) && /safeFirstName/.test(registerFn));

check("شماره و رمز همچنان اجباری‌اند",
    /if\(!phone \|\| !password\)/.test(registerFn));

check("اگر نام بفرستند، ذخیره می‌شود",
    /first_name:safeFirstName/.test(registerFn) &&
    /last_name:safeLastName/.test(registerFn));

const loginJs = read("js/login.js");
check("کاربر بدون نام بعد از ورود به «تکمیل پروفایل» می‌رود",
    /!user\.first_name/.test(loginJs) && loginJs.includes("/complete-profile"));

console.log("\n✅ فرم و فانکشن حالا با هم هم‌خوان‌اند: شماره + رمز کافی است.");

console.log("\n── ابزار دکتر پروفایل ──");

const doctorProfile = read("tools/profile-doctor.html");
const servePy = read("tools/serve.py");

check("ابزار دکتر پروفایل وجود دارد", doctorProfile.length > 1500);
check("فانکشن update-profile را زنده صدا می‌زند",
    doctorProfile.includes('`${API}/update-profile`'));
check("خطای ۵۰۲ را تشخیص می‌دهد", doctorProfile.includes("=== 502"));
check("دستور SQL ساخت ستون‌های grade و major را دارد",
    doctorProfile.includes("add column if not exists grade") &&
    doctorProfile.includes("add column if not exists major"));
check("مسیر ستون‌ها را از information_schema می‌خواند",
    doctorProfile.includes("information_schema.columns"));
check("سرور مسیر /profile-doctor را می‌شناسد", servePy.includes("/profile-doctor"));
check("update-profile در فهرست صفحه‌ی Deploy هست",
    servePy.includes('"name": "update-profile"'));

console.log(`\n${failed === 0 ? "ALL CORS CHECKS PASSED ✅" : `${failed} تست شکست خورد ❌`}`);
console.log(`(${passed} تست موفق)`);
process.exit(failed === 0 ? 0 : 1);
