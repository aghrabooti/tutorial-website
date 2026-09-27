// تست چرخه‌ی «ورود → تکمیل پروفایل → داشبورد»
//
// چرا این تست؟ چون کاربر گزارش داد: «می‌نویسد ذخیره شد ولی باز همان صفحه می‌آید».
// علت سه باگ بود:
//   ۱) js/dashboard.js فقط result.valid را قبول می‌کرد، ولی check-session
//      {success:true, user} برمی‌گرداند → داشبورد حافظه را پاک می‌کرد و
//      کاربر را به /login می‌فرستاد.
//   ۲) js/login.js برای کسی که پایه‌ی نهم انتخاب کرده (رشته ندارد) هم رشته
//      می‌خواست → دوباره به /complete-profile برمی‌گشت.
//   ۳) js/complete-profile.js بعد از ذخیره، «user» داخل حافظه‌ی مرورگر را
//      به‌روز نمی‌کرد → صفحات دیگر اطلاعات کهنه می‌دیدند.
//
// این فایل هر سه را با اجرای واقعی همان فایل‌های js/ در یک DOM شبیه‌سازی‌شده
// بررسی می‌کند (نه فقط سرچ متنی).
//
// اجرا:  node profile-flow.test.mjs   (بعد از node build.mjs)
import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

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

/* ═══════════════════════════════════════════════════════════════
   چارچوب: اجرای فایل‌های js/ سایت با window و DOM شبیه‌سازی‌شده
   ═══════════════════════════════════════════════════════════════ */

function makeHarness(html = "<!doctype html><html><body></body></html>", url = "https://www.mahdiazizi.com/") {
    const dom = new JSDOM(html, { url });

    // localStorage شبیه‌سازی‌شده (قابل بازرسی در تست)
    const store = new Map();
    const localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        get length() { return store.size; },
    };

    const navigation = { href: null };
    const window = {
        location: navigation,
        localStorage,
        alert: (msg) => { harness.alerts.push(String(msg)); },
        setTimeout: (fn) => { setTimeout(fn, 0); return 0; },
        clearInterval: () => {},
        setInterval: () => 0,
        console,
        Event: dom.window.Event,
        JSON,
        Object,
        Number,
        String,
        Boolean,
        Array,
        Date,
        Math,
        Promise,
        isNaN,
        encodeURIComponent,
        decodeURIComponent,
    };

    // document با هر getElementById که بخواهند کار می‌کند
    const genericEls = new Map();
    const makeEl = (id) => {
        const el = dom.window.document.createElement("div");
        el.id = id;

        const events = {};

        return new Proxy(el, {
            get(target, prop) {
                if (prop === "addEventListener") {
                    return (ev, fn) => {
                        (events[ev] = events[ev] || []).push(fn);
                    };
                }
                if (prop === "dispatchEvent") {
                    return (ev) => {
                        (events[ev.type] || []).forEach((fn) => fn(ev));
                        return true;
                    };
                }
                if (prop === "removeEventListener") return () => {};

                const value = target[prop];
                return typeof value === "function" ? value.bind(target) : value;
            },
            set(target, prop, value) {
                try {
                    target[prop] = value;
                } catch (e) {
                    /* خصوصیت‌های فقط‌خوان مثل dataset — بی‌خیال */
                }
                return true;
            },
        });
    };

    const document = new Proxy(dom.window.document, {
        get(target, prop) {
            if (prop === "getElementById") {
                return (id) => {
                    if (!genericEls.has(id)) genericEls.set(id, makeEl(id));
                    return genericEls.get(id);
                };
            }
            if (prop === "querySelector") return () => makeEl("query");
            if (prop === "querySelectorAll") return () => [];
            if (prop === "createElement") return (tag) => dom.window.document.createElement(tag);
            const value = target[prop];
            return typeof value === "function" ? value.bind(target) : value;
        },
    });

    const calls = [];
    const handlers = {};

    const apiCall = async (name, payload) => {
        calls.push({ name, payload });
        const handler = handlers[name];
        return typeof handler === "function" ? handler(payload) : {};
    };

    const harness = {
        window,
        document,
        localStorage,
        navigation,
        calls,
        alerts: [],
        handlers,
        element: (id) => document.getElementById(id),

        run(relPath) {
            const src = read(relPath);
            const fn = new Function(
                "window", "document", "localStorage", "apiCall", "alert",
                "setTimeout", "setInterval", "clearInterval", "console",
                "Event", "location", "fetch",
                src
            );
            fn(
                window, document, localStorage, apiCall, window.alert,
                window.setTimeout, window.setInterval, window.clearInterval,
                console, dom.window.Event, navigation, async () => { throw new Error("fetch ممنوع"); }
            );
            return harness;
        },

        async tick(ms = 5) {
            await new Promise((r) => setTimeout(r, ms));
        },
    };

    return harness;
}

/* ═══════════════════════════════════════════════════════════════
   ۱) ورود — کاربر پایه نهم (رشته ندارد)
   ═══════════════════════════════════════════════════════════════ */

console.log("── ورود کاربر با پایه نهم (بدون رشته) ──");

{
    const h = makeHarness();
    h.handlers["login-user"] = () => ({
        success: true,
        token: "tok-1",
        user: { first_name: "علی", last_name: "رضایی", grade: "9", major: "", role: "student" },
    });

    h.run("js/login.js");
    h.element("phone").value = "09120000001";
    h.element("password").value = "test1234";

    const btn = h.element("login-btn");
    await btn.dispatchEvent({ type: "click" });
    await h.tick(20);

    check("کاربر پایه نهم بعد از ورود به داشبورد می‌رود (نه دوباره تکمیل پروفایل)",
        h.navigation.href === "/dashboard", String(h.navigation.href));
}

/* ═══════════════════════════════════════════════════════════════
   ۲) ورود — کاربر بدون نام (هنوز پروفایل را کامل نکرده)
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── ورود کاربر بدون نام ──");

{
    const h = makeHarness();
    h.handlers["login-user"] = () => ({
        success: true,
        token: "tok-2",
        user: { first_name: "", last_name: "", grade: "", major: "", role: "student" },
    });

    h.run("js/login.js");
    h.element("phone").value = "09120000002";
    h.element("password").value = "test1234";

    await h.element("login-btn").dispatchEvent({ type: "click" });
    await h.tick(20);

    check("کاربر بدون نام به تکمیل پروفایل می‌رود",
        h.navigation.href === "/complete-profile", String(h.navigation.href));
}

/* ═══════════════════════════════════════════════════════════════
   ۳) ورود — کاربر پایه یازدهم با رشته
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── ورود کاربر پایه یازدهم با رشته ──");

{
    const h = makeHarness();
    h.handlers["login-user"] = () => ({
        success: true,
        token: "tok-3",
        user: { first_name: "سارا", last_name: "محمدی", grade: "11", major: "ریاضی", role: "student" },
    });

    h.run("js/login.js");
    h.element("phone").value = "09120000003";
    h.element("password").value = "test1234";

    await h.element("login-btn").dispatchEvent({ type: "click" });
    await h.tick(20);

    check("کاربر کامل به داشبورد می‌رود", h.navigation.href === "/dashboard",
        String(h.navigation.href));
}

/* ═══════════════════════════════════════════════════════════════
   ۴) داشبورد — نشست سالم (باگ اصلی: حافظه پاک می‌شد و به /login می‌رفت)
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── داشبورد با نشست سالم ──");

{
    const h = makeHarness();
    h.localStorage.setItem("session_token", "tok-dash");
    h.localStorage.setItem("user", JSON.stringify({ first_name: "سارا", last_name: "محمدی" }));

    h.handlers["check-session"] = () => ({
        success: true,
        user: {
            first_name: "سارا", last_name: "محمدی", grade: "11",
            major: "ریاضی", phone: "989120000003", role: "student",
        },
    });
    h.handlers["get-my-courses"] = () => ({ success: true, courses: [] });

    h.run("js/dashboard.js");
    await h.tick(30);

    check("داشبورد نشست سالم را قبول می‌کند (کاربر بیرون نمی‌افتد)",
        h.navigation.href === null, String(h.navigation.href));
    check("حافظه‌ی مرورگر پاک نمی‌شود",
        h.localStorage.getItem("session_token") === "tok-dash");
    check("نام کاربر روی داشبورد نوشته می‌شود",
        h.element("user-first-name").textContent === "سارا",
        h.element("user-first-name").textContent);
    check("پایه و رشته روی داشبورد نوشته می‌شود",
        h.element("profile-grade").textContent !== "" &&
        h.element("profile-field").textContent === "ریاضی فیزیک",
        `${h.element("profile-grade").textContent} / ${h.element("profile-field").textContent}`);
}

/* ═══════════════════════════════════════════════════════════════
   ۵) داشبورد — نشست نامعتبر
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── داشبورد با نشست نامعتبر ──");

{
    const h = makeHarness();
    h.localStorage.setItem("session_token", "tok-bad");

    h.handlers["check-session"] = () => ({ success: false, error: "نشست معتبر نیست" });

    h.run("js/dashboard.js");
    await h.tick(30);

    check("نشست نامعتبر → خروج و رفتن به /login",
        h.navigation.href === "/login", String(h.navigation.href));
    check("در این حالت حافظه پاک می‌شود",
        h.localStorage.getItem("session_token") === null);
}

/* ═══════════════════════════════════════════════════════════════
   ۶) تکمیل پروفایل — ذخیره‌ی پایه نهم و به‌روز شدن حافظه
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── تکمیل پروفایل: ذخیره ──");

async function completeProfile({ grade, major, storedUser }) {
    const h = makeHarness();

    h.localStorage.setItem("session_token", "tok-profile");
    h.localStorage.setItem("user", JSON.stringify(storedUser));

    h.handlers["check-session"] = () => ({
        success: true,
        user: { first_name: "", last_name: "", grade: "", major: "", phone: "989120000004" },
    });
    h.handlers["update-profile"] = (payload) => ({
        success: true,
        user: {
            first_name: payload.first_name, last_name: payload.last_name,
            grade: payload.grade, major: payload.major || "",
        },
    });

    h.run("js/complete-profile.js");
    await h.tick(15);

    h.element("first-name").value = "علی";
    h.element("last-name").value = "رضایی";
    h.element("grade").value = grade;
    h.element("major").value = major;

    // فرم ارسال می‌شود (همان شناسه‌ی واقعی در complete-profile.js)
    const form = h.element("profile-form");
    await form.dispatchEvent({ type: "submit", preventDefault() {} });
    await h.tick(20);

    return h;
}

{
    const h = await completeProfile({ grade: "9", major: "", storedUser: { role: "student", phone: "989120000004" } });

    check("ذخیره‌ی پایه نهم پیام موفقیت می‌دهد",
        h.alerts.some((a) => a.includes("ذخیره شد")), JSON.stringify(h.alerts));
    check("بعد از ذخیره به داشبورد می‌رود", h.navigation.href === "/dashboard",
        String(h.navigation.href));

    const saved = JSON.parse(h.localStorage.getItem("user") || "{}");
    check("نام در حافظه‌ی مرورگر به‌روز شده", saved.first_name === "علی", JSON.stringify(saved));
    check("پایه در حافظه ذخیره شده", saved.grade === "9");
    check("رشته‌ی خالی برای پایه نهم مشکلی ندارد", saved.major === "");
    check("بقیه‌ی اطلاعات کاربر (نقش/شماره) حفظ شده",
        saved.role === "student" && saved.phone === "989120000004", JSON.stringify(saved));
}

/* ═══════════════════════════════════════════════════════════════
   ۷) چرخه‌ی کامل: تکمیل پروفایل → داشبورد (بدون برگشت به همان صفحه)
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── چرخه‌ی کامل: ذخیره → داشبورد → ورود دوباره ──");

{
    // مرحله ۱: کاربر پروفایلش را ذخیره می‌کند
    const afterSave = await completeProfile({
        grade: "11", major: "تجربی",
        storedUser: { role: "student", phone: "989120000004" },
    });

    check("مرحله ۱: ذخیره انجام شد", afterSave.navigation.href === "/dashboard");

    // مرحله ۲: داشبورد با همان نشست باز می‌شود
    const dash = makeHarness();
    dash.localStorage.setItem("session_token", "tok-profile");
    dash.localStorage.setItem("user", afterSave.localStorage.getItem("user"));

    const savedUser = JSON.parse(afterSave.localStorage.getItem("user"));

    dash.handlers["check-session"] = () => ({ success: true, user: savedUser });
    dash.handlers["get-my-courses"] = () => ({ success: true, courses: [] });

    dash.run("js/dashboard.js");
    await dash.tick(30);

    check("مرحله ۲: داشبورد باز می‌مانَد (به login/complete-profile پرت نمی‌شود)",
        dash.navigation.href === null, String(dash.navigation.href));
    check("مرحله ۲: حافظه دست‌نخورده است",
        dash.localStorage.getItem("session_token") === "tok-profile");

    // مرحله ۳: خروج و ورود دوباره — همان کاربر، همان اطلاعات
    const login = makeHarness();
    login.handlers["login-user"] = () => ({ success: true, token: "tok-new", user: savedUser });

    login.run("js/login.js");
    login.element("phone").value = "09120000004";
    login.element("password").value = "test1234";
    await login.element("login-btn").dispatchEvent({ type: "click" });
    await login.tick(20);

    check("مرحله ۳: ورود دوباره باز هم به تکمیل پروفایل نمی‌رود",
        login.navigation.href === "/dashboard", String(login.navigation.href));
}

/* ═══════════════════════════════════════════════════════════════ */

console.log(`\n${failed === 0 ? "ALL PROFILE FLOW CHECKS PASSED ✅" : `${failed} تست شکست خورد ❌`}`);
console.log(`(${passed} تست موفق)`);
process.exit(failed === 0 ? 0 : 1);
