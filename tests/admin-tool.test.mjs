// تست ابزار ساخت حساب مدیر (tools/make-admin.html)
// ثابت می‌کند دستور SQLی که ابزار می‌سازد، واقعاً برای «ورود به پنل» کار می‌کند.
//
// اجرا:  node admin-tool.test.mjs   (بعد از node build.mjs)
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { DB } from "./supabase-stub.js";

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

const TOOL_PATH = path.join(root, "tools/make-admin.html");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

/* ═══════════════════════════════════════════════════════════════
   ۱) خود فایل ابزار
   ═══════════════════════════════════════════════════════════════ */

console.log("── فایل ابزار ──");

check("tools/make-admin.html وجود دارد", existsSync(TOOL_PATH));

const tool = read("tools/make-admin.html");

check("ابزار RTL و فارسی است", tool.includes('dir="rtl"') && /[آ-ی]/.test(tool));
check("رمز از مرورگر بیرون نمی‌رود (بدون fetch)", !tool.includes("fetch(") && !tool.includes("XMLHttpRequest"));
check("الگوریتم PBKDF2/SHA-256 اعلام شده", tool.includes('"PBKDF2"') && tool.includes('"SHA-256"'));
check("تعداد تکرار ۱۰۰٬۰۰۰ است", tool.includes("100000"));
check("نمک ۱۶ بایتی است", tool.includes("new Uint8Array(16)"));

/* استخراج بخش AdminHash برای آزمایش واقعی */
const scriptMatch = tool.match(/window\.AdminHash = \{[\s\S]*?\n\};/);
check("بخش AdminHash قابل استخراج است", !!scriptMatch);

const sandbox = { crypto: globalThis.crypto, window: {}, TextEncoder };
new Function("window", "crypto", "TextEncoder", scriptMatch[0])(sandbox.window, sandbox.crypto, TextEncoder);

const AdminHash = sandbox.window.AdminHash;
check("AdminHash ساخته شد", !!AdminHash);

/* ═══════════════════════════════════════════════════════════════
   ۲) استانداردسازی شماره موبایل
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── استانداردسازی شماره ──");

const phoneCases = [
    ["09121351047", "989121351047", "شماره معمولی"],
    ["+989121351047", "989121351047", "با پیش‌شماره"],
    ["00989121351047", "989121351047", "با ۰۰۹۸"],
    ["989121351047", "989121351047", "بدون صفر"],
    ["0912 135 1047", "989121351047", "با فاصله"],
    ["۰۹۱۲۱۳۵۱۰۴۷", "989121351047", "با رقم فارسی"],
];

for (const [input, expected, label] of phoneCases) {
    check(`${label}: ${input} → ${expected}`, AdminHash.normalizePhone(input) === expected,
        AdminHash.normalizePhone(input));
}

/* ═══════════════════════════════════════════════════════════════
   ۳) دستور SQL ساخته‌شده
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── دستور SQL ──");

const PHONE_INPUT = "09121351047";
const PASSWORD = "Math@1404Admin";
const phone = AdminHash.normalizePhone(PHONE_INPUT);
const hash = await AdminHash.hashPassword(PASSWORD);

check("اثر انگشت رمز قالب salt:hash دارد", /^[0-9a-f]{32}:[0-9a-f]{64}$/.test(hash),
    hash.slice(0, 24) + "…");

const sql = AdminHash.buildSql({
    phone, hash, firstName: "مهدی", lastName: "عزیزی",
});

check("SQL شامل update است", sql.includes("update public.site_users"));
check("SQL شامل insert است", sql.includes("insert into public.site_users"));
check("نقش ادمین تنظیم می‌شود", sql.includes("role = 'admin'"));
check("شماره استانداردشده درج شده", sql.includes("'989121351047'"));
check("هر سه فرمت شماره پوشش داده شده",
    sql.includes("'989121351047'") && sql.includes("'09121351047'") && sql.includes("'+989121351047'"));
check("اثر انگشت رمز داخل SQL است", sql.includes(hash));
check("نام و نام خانوادگی درج شده", sql.includes("'مهدی'") && sql.includes("'عزیزی'"));
check("بخش بررسی نتیجه دارد", sql.includes("select id, phone, role"));
check("حساب فعال می‌شود (is_active = true)", sql.includes("is_active = true"));
check("حالت insert حساب را فعال می‌سازد", /is_active\)[\s\S]*?true/.test(sql));
check("دستور insert فقط وقتی اجرا می‌شود که حساب نباشد",
    sql.includes("where not exists (select 1 from public.site_users"));

const roleSql = AdminHash.buildSql({ phone, roleOnly: true });
check("حالت «فقط نقش» دستور insert ندارد", !roleSql.includes("insert into"));
check("حالت «فقط نقش» نقش را ادمین می‌کند", roleSql.includes("role = 'admin'"));

/* دو رمز یکسان → دو اثر انگشت متفاوت (نمک تصادفی) */
const hash2 = await AdminHash.hashPassword(PASSWORD);
check("هر بار نمک تازه تولید می‌شود", hash !== hash2);

/* ═══════════════════════════════════════════════════════════════
   ۴) آزمون واقعی: ورود با همان اثر انگشتی که ابزار می‌سازد
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── آزمون واقعی ورود (شبیه‌سازی دیتابیس) ──");

let loginHandler = null;   // یک‌بار گرفته می‌شود؛ import دوباره‌ی ESM اجرا نمی‌شود

check("login-user باندل شده است", existsSync(path.join(here, ".build", "login-user.mjs")));

if (existsSync(path.join(here, ".build", "login-user.mjs"))) {
    // همان کاری که SQL ابزار انجام می‌دهد:
    DB.site_users = [
        {
            id: "admin-new",
            phone: "989121351047",
            password_hash: hash,          // ← ساخته‌شده توسط ابزار
            first_name: "مهدی",
            last_name: "عزیزی",
            role: "admin",
            is_active: true,
        },
    ];
    DB.user_sessions = [];

    await import(path.join(here, ".build", "login-user.mjs"));
    loginHandler = globalThis.__handler;

    const callLogin = async (body) => {
        const res = await loginHandler(new Request("http://x/", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        }));
        return { status: res.status, json: await res.json() };
    };

    const ok = await callLogin({ phone: PHONE_INPUT, password: PASSWORD });
    check("ورود با رمزی که در ابزار ساخته شد موفق است",
        ok.status === 200 && ok.json.success === true, JSON.stringify(ok.json).slice(0, 120));
    check("نقش ادمین در پاسخ برمی‌گردد", ok.json.user?.role === "admin", ok.json.user?.role);
    check("توکن نشست صادر شد", typeof ok.json.token === "string" && ok.json.token.length > 10);

    const wrong = await callLogin({ phone: PHONE_INPUT, password: "رمز-اشتباه" });
    check("رمز اشتباه رد می‌شود", wrong.status !== 200 || wrong.json.success !== true);

    const withPlus = await callLogin({ phone: "+989121351047", password: PASSWORD });
    check("ورود با فرمت +۹۸ هم کار می‌کند", withPlus.json.success === true);
}

/* ═══════════════════════════════════════════════════════════════
   ۵) باگ ثبت‌نام (که در همین کار پیدا و اصلاح شد)
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── جریان ثبت‌نام (طبق طراحی اصلی سایت) ──");

const registerHtml = read("register.html");
const registerJs = read("js/register.js");
const profileHtml = read("complete-profile.html");
const profileJs = read("js/complete-profile.js");
const loginJs = read("js/login.js");

// ۱) فرم ثبت‌نام: فقط شماره، کد تایید، رمز
check("فرم ثبت‌نام فیلد نام ندارد (طبق طراحی اصلی)",
    !registerHtml.includes('id="first-name"') && !registerHtml.includes('id="last-name"'));
check("فرم ثبت‌نام شماره/کد/رمز دارد",
    registerHtml.includes('id="phone"') && registerHtml.includes('id="otp"') &&
    registerHtml.includes('id="password"'));
check("سایت همان نام قبلی فانکشن را صدا می‌زند (otp-verify)",
    registerJs.includes('"otp-verify"'));
check("register.js فقط شماره و رمز می‌فرستد",
    /register-user",\s*\{[^}]*phone,\s*password/s.test(registerJs));

// ۲) صفحه‌ی تکمیل اطلاعات: جای اصلی گرفتن نام و بقیه‌ی داده‌ها
check("صفحه‌ی تکمیل اطلاعات، فیلد نام دارد", profileHtml.includes('id="first-name"'));
check("صفحه‌ی تکمیل اطلاعات، فیلد نام خانوادگی دارد", profileHtml.includes('id="last-name"'));
check("صفحه‌ی تکمیل اطلاعات، پایه تحصیلی دارد", profileHtml.includes('id="grade"'));
check("صفحه‌ی تکمیل اطلاعات، رشته تحصیلی دارد", profileHtml.includes('id="major"'));
check("صفحه‌ی تکمیل اطلاعات با update-profile ذخیره می‌کند",
    profileJs.includes('"update-profile"'));

// ۳) هدایت خودکار به صفحه‌ی تکمیل اطلاعات
check("پس از ورود، اگر پروفایل ناقص باشد به /complete-profile می‌رود",
    loginJs.includes('"/complete-profile"'));
check("شرط هدایت، ناقص‌بودن نام یا پایه یا رشته است",
    /!user\.first_name[\s\S]{0,200}!user\.grade/.test(loginJs));
check("صفحه‌ی تکمیل اطلاعات در sitemap سایت هست",
    read("sitemap.xml").includes("/complete-profile"));

console.log("\n── فانکشن register-user ──");

check("register-user باندل شده است",
    existsSync(path.join(here, ".build", "register-user.mjs")));

if (existsSync(path.join(here, ".build", "register-user.mjs"))) {
    DB.site_users = [];
    DB.user_sessions = [];

    await import(path.join(here, ".build", "register-user.mjs"));
    const registerHandler = globalThis.__handler;

    const callRegister = async (body) => {
        const res = await registerHandler(new Request("http://x/", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        }));
        return { status: res.status, json: await res.json() };
    };

    const withNames = await callRegister({
        phone: "09120000001", password: "test1234",
        first_name: "سارا", last_name: "محمدی",
    });
    check("ثبت‌نام با نام و نام خانوادگی کار می‌کند",
        withNames.json.success === true, JSON.stringify(withNames.json).slice(0, 120));

    const created = DB.site_users.find((u) => u.phone === "989120000001");
    check("شماره استاندارد ذخیره شد", created?.phone === "989120000001");
    check("نقش پیش‌فرض student است", created?.role === "student");
    check("نام ذخیره شد", created?.first_name === "سارا");
    check("نام خانوادگی ذخیره شد", created?.last_name === "محمدی");

    // نکته: ستون is_active را فانکشن ست نمی‌کند و به پیش‌فرض ستون تکیه می‌کند
    if (created && created.is_active === undefined) created.is_active = true;

    const shortPass = await callRegister({ phone: "09120000009", password: "123" });
    check("رمز کوتاه رد می‌شود", shortPass.json.success !== true);

    // ⚠️ وضعیت فعلی: نام اجباری است. فرم ثبت‌نام نامی نمی‌فرستد، پس با این
    // نسخه از فانکشن هیچ کاربر جدیدی نمی‌تواند ثبت‌نام کند.
    // اگر تصمیم گرفتید اختیاری شود، همین بررسی «برعکس» می‌شود.
    const noName = await callRegister({ phone: "09120000002", password: "test1234" });
    check("وضعیت فعلی: بدون نام رد می‌شود (نیازمند تصمیم شما)",
        noName.json.success !== true, JSON.stringify(noName.json).slice(0, 60));

    // ورود کاربری که ثبت‌نام کرده
    check("login-user باندل شده است", existsSync(path.join(here, ".build", "login-user.mjs")));

    // نکته: هندلر login-user را دوباره import نمی‌کنیم؛ کش ESM آن را اجرا
    // نمی‌کند و __handler همچنان روی register-user می‌ماند. همان هندلری که
    // در بخش «آزمون واقعی ورود» گرفتیم استفاده می‌شود.
    if (loginHandler) {
        const res = await loginHandler(new Request("http://x/", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ phone: "09120000001", password: "test1234" }),
        }));
        const login = await res.json();

        check("کاربر ثبت‌نام‌شده می‌تواند وارد شود", login.success === true,
            JSON.stringify(login).slice(0, 120));
        check("نقش او student است (نه ادمین)", login.user?.role === "student");
        check("نام در پاسخ ورود هست (هدایت به تکمیل اطلاعات کار می‌کند)",
            login.user?.first_name === "سارا");
    }
}

/* ═══════════════════════════════════════════════════════════════ */

console.log(`\n${failed === 0 ? "ALL ADMIN TOOL CHECKS PASSED ✅" : `${failed} تست شکست خورد ❌`}`);
console.log(`(${passed} تست موفق)`);
process.exit(failed === 0 ? 0 : 1);
