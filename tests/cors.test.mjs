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
    const handler = await loadHandler("register-user", "post-missing");

    const res = await handler(new Request("http://x/", {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "09121351047", password: "123456" }),
    }));

    const body = await res.json();

    check("پاسخ خطای register-user هم هدر CORS دارد (پیام خطا به کاربر می‌رسد)",
        firewallFree(res), `ACAO=${res.headers.get("access-control-allow-origin")}`);
    check("register-user بدون نام، خطای «اطلاعات ناقص است» می‌دهد",
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
   ۴) آیا کد جدید ثبت‌نام با فرم سایت هم‌خوان است؟
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── هم‌خوانی فرم ثبت‌نام با فانکشن register-user ──");

const registerJs = read("js/register.js");
const registerHtml = read("register.html");
const registerFn = read("supabase/functions/register-user/index.ts");

check("فرم ثبت‌نام نام نمی‌فرستد (طراحی: نام در تکمیل پروفایل)",
    !registerJs.includes("first_name") && !registerHtml.includes("first_name"));

check("ولی فانکشن register-user نام و نام خانوادگی را اجباری می‌خواهد",
    /!first_name/.test(registerFn) && /!last_name/.test(registerFn));

console.log(
    "\n⚠️  توجه: این دو با هم هم‌خوان نیستند — یا فرم باید نام بگیرد،" +
    "\n   یا فانکشن باید بدون نام کاربر بسازد (تصمیم با کاربر است)."
);

console.log(`\n${failed === 0 ? "ALL CORS CHECKS PASSED ✅" : `${failed} تست شکست خورد ❌`}`);
console.log(`(${passed} تست موفق)`);
process.exit(failed === 0 ? 0 : 1);
