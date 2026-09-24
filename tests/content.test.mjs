// تست‌های «لودینگ» و «محتوای سایت» (ویرایش متن‌ها و عکس‌ها از پنل ادمین)
// اجرا:  node content.test.mjs   (بعد از node build.mjs)
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
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

const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const pages = readdirSync(root).filter((f) => f.endsWith(".html"));

/* ═══════════════════════════════════════════════════════════════
   ۱) لودر سراسری
   ═══════════════════════════════════════════════════════════════ */

console.log("── لودر سراسری صفحه ──");

check("css/loader.css وجود دارد", existsSync(path.join(root, "css/loader.css")));
check("js/loader.js وجود دارد", existsSync(path.join(root, "js/loader.js")));

const loaderCss = read("css/loader.css");
const loaderJs = read("js/loader.js");

check("CSS لودر اسپینر دارد", loaderCss.includes("@keyframes pl-spin"));
check("CSS لودر انیمیشن نفس‌کشیدن نشان دارد", loaderCss.includes("@keyframes pl-breathe"));
check("CSS اسکلتون درخشش دارد", loaderCss.includes("@keyframes sk-shine"));
check("CSS به «کاهش انیمیشن» کاربر احترام می‌گذارد", loaderCss.includes("prefers-reduced-motion"));
check("CSS در چاپ لودر را پنهان می‌کند", loaderCss.includes("@media print"));
check("JS در پایان لودر را از DOM حذف می‌کند", loaderJs.includes("el.remove()"));
check("JS قفل اطمینان دارد (گیر‌نکردن صفحه)", loaderJs.includes("MAX_SHOW"));
check("JS ابزار اسکلتون کارت دارد", loaderJs.includes("cards:"));
check("JS اسپینر دکمه دارد", loaderJs.includes("btnLoading"));

for (const page of pages) {
  const html = read(page);
  const hasCss = html.includes("/css/loader.css");
  const hasJs = html.includes("/js/loader.js");
  const hasOverlay = html.includes('id="page-loader"');
  const hasNoscript = html.includes("noscript") && html.includes("#page-loader");

  check(`${page}: لودر کامل (css/js/مارک‌آپ/no-js)`,
    hasCss && hasJs && hasOverlay && hasNoscript);
}

console.log("\n── جایگزینی متن «در حال بارگذاری» با اسکلتون ──");

check("صفحه اصلی اسکلتون اولیه دارد", read("index.html").includes("sk-card"));
check("اسلایدر صفحه اصلی اسکلتون می‌گیرد", read("js/home.js").includes("Skeleton.cards"));
check("صفحه دوره‌ها اسکلتون می‌گیرد", read("js/courses.js").includes("Skeleton.cards"));

console.log("\n── عملکرد لودر در مرورگر (jsdom) ──");

{
  const html = read("index.html");
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;

  window.eval(loaderJs);

  const overlay = window.document.getElementById("page-loader");
  check("لودر در ابتدا دیده می‌شود", !!overlay && !overlay.classList.contains("is-done"));

  window.eval(`
    window.dispatchEvent(new Event("load"));
  `);

  await new Promise((r) => setTimeout(r, 500));

  check("بعد از load، لودر مخفی می‌شود",
    !overlay || overlay.classList.contains("is-done"));

  check("نوار پیشرفت هم مخفی می‌شود",
    !window.document.getElementById("page-loader-bar") ||
    window.document.getElementById("page-loader-bar").style.opacity === "0");
}

/* ═══════════════════════════════════════════════════════════════
   ۲) فهرست محتوا (manifest) و هم‌خوانی با HTML
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── فهرست محتوای قابل ویرایش ──");

const manifestSrc = read("js/content-manifest.js");
const sandbox = {};
new Function("window", manifestSrc)(sandbox);

const MANIFEST = sandbox.SITE_CONTENT_MANIFEST;
const MANIFEST_KEYS = sandbox.SITE_CONTENT_KEYS;

check("manifest بارگذاری می‌شود", !!MANIFEST);
check("گروه‌ها تعریف شده‌اند", (MANIFEST?.groups ?? []).length >= 6,
  `${MANIFEST?.groups?.length} گروه`);

const dupes = MANIFEST_KEYS.filter((k, i) => MANIFEST_KEYS.indexOf(k) !== i);
check("هیچ کلید تکراری در manifest نیست", dupes.length === 0, dupes.join(", "));

check("همه‌ی فیلدها برچسب فارسی دارند",
  MANIFEST.groups.every((g) => g.items.every((i) => i.label && /[\u0600-\u06FF]/.test(i.label))));

check("همه‌ی فیلدها پیش‌فرض دارند",
  MANIFEST.groups.every((g) => g.items.every((i) => i.default !== undefined)));

/* هر کلید manifest باید در HTML هم وجود داشته باشد */
const KEYED_FILES = ["index.html", "about-us.html", "courses.html", "components/footer.html"];
const keyedFiles = Object.fromEntries(KEYED_FILES.map((f) => [f, read(f)]));

const missingInHtml = MANIFEST_KEYS.filter((key) =>
  !KEYED_FILES.some((f) =>
    keyedFiles[f].includes(`data-content="${key}"`) ||
    keyedFiles[f].includes(`data-content-img="${key}"`)));

check("هر کلید manifest در HTML هم هست", missingInHtml.length === 0,
  missingInHtml.join(", "));

/* و برعکس: هر کلید داخل HTML باید در manifest باشد */
const htmlKeys = new Set();
for (const f of KEYED_FILES) {
  for (const m of keyedFiles[f].matchAll(/data-content(?:-img)?="([^"]+)"/g)) {
    htmlKeys.add(m[1]);
  }
}

const unknownKeys = [...htmlKeys].filter((k) => !MANIFEST_KEYS.includes(k));
check("هیچ کلید ناشناسی در HTML نیست", unknownKeys.length === 0, unknownKeys.join(", "));

check("تعداد کلیدهای قابل ویرایش", MANIFEST_KEYS.length >= 45, `${MANIFEST_KEYS.length} کلید`);

/* تصاویر: هر کلید از نوع image باید data-content-img داشته باشد */
const imageItems = MANIFEST.groups.flatMap((g) => g.items).filter((i) => i.type === "image");
check("فیلدهای تصویری تعریف شده‌اند", imageItems.length >= 2, `${imageItems.length} تصویر`);

for (const item of imageItems) {
  const found = KEYED_FILES.some((f) => keyedFiles[f].includes(`data-content-img="${item.key}"`));
  check(`تصویر ${item.key} در HTML علامت‌گذاری شده`, found);
}

/* ═══════════════════════════════════════════════════════════════
   ۳) اعمال محتوا روی صفحه (js/site-content.js)
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── اعمال متن‌ها روی صفحه ──");

{
  const dom = new JSDOM(read("index.html"), {
    runScripts: "outside-only",
    url: "https://www.mahdiazizi.com/",
  });
  const { window } = dom;

  window.eval(read("js/site-content.js"));

  const applied = window.SiteContent.apply({
    "home.badge": "⚡ تست ویرایش از پنل",
    "home.title_1": "عنوان تازه",
    "home.stat_students": "2500",
    "home.courses_tag": "دسته‌بندی تازه",
    "home.hero_image": "https://example.com/new.jpg",
  });

  check("محتوا اعمال شد", applied >= 5, `${applied} عنصر`);

  const badge = window.document.querySelector('[data-content="home.badge"]');
  check("متن ساده عوض شد", badge?.textContent === "⚡ تست ویرایش از پنل");

  const counter = window.document.querySelector('[data-content="home.stat_students"]');
  check("عدد انیمیشنی با رقم فارسی نوشته شد",
    counter?.textContent === (2500).toLocaleString("fa-IR") || counter?.textContent === "۲٬۵۰۰",
    counter?.textContent);
  check("مقدار data-count هم به‌روز شد", counter?.dataset.count === "2500");

  const img = window.document.querySelector('[data-content-img="home.hero_image"]');
  check("عکس عوض شد", img?.getAttribute("src") === "https://example.com/new.jpg");

  // کلید ناشناخته نباید چیزی را خراب کند
  const n2 = window.SiteContent.apply({ "not.a.real.key": "x" });
  check("کلید ناشناخته نادیده گرفته می‌شود", n2 === 0);

  // مقدار خالی = برگشت به پیش‌فرض، نه پاک‌کردن متن
  window.SiteContent.apply({ "home.badge": "" });
  check("مقدار خالی متن را پاک نمی‌کند", badge?.textContent.length > 3);
}

/* ═══════════════════════════════════════════════════════════════
   ۴) فانکشن site-content
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── فانکشن site-content ──");

const built = path.join(here, ".build", "site-content.mjs");
check("فانکشن باندل شده است (node build.mjs)", existsSync(built));

if (existsSync(built)) {
  const TOKEN = "admin-token-content";
  const tokenHash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN)))
  ).map((b) => b.toString(16).padStart(2, "0")).join("");

  DB.site_users = [
    { id: "admin1", role: "admin" },
    { id: "user1", role: "user" },
  ];

  DB.user_sessions = [
    { id: "s1", user_id: "admin1", token_hash: tokenHash, is_active: true, expires_at: "2030-01-01T00:00:00Z" },
  ];

  DB.site_content = [
    { key: "home.badge", value: "متن ذخیره‌شده", updated_at: "2026-09-20T10:00:00Z" },
    { key: "home.title_1", value: "", updated_at: "2026-09-20T10:00:00Z" },
  ];

  await import(built);
  const handler = globalThis.__handler;

  const call = async (body) => {
    const res = await handler(new Request("http://x/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    return { status: res.status, json: await res.json() };
  };

  const get = await call({ action: "get" });
  check("خواندن عمومی کار می‌کند", get.status === 200 && get.json.success === true);
  check("مقدار ذخیره‌شده برگردانده می‌شود", get.json.content["home.badge"] === "متن ذخیره‌شده");
  check("مقدار خالی در پاسخ نمی‌آید", !("home.title_1" in get.json.content));

  const noToken = await call({ action: "set", items: { "home.badge": "هک" } });
  check("ذخیره بدون توکن رد می‌شود", noToken.status === 401);

  const wrongRole = await call({ token: "bad-token", action: "set", items: { "home.badge": "هک" } });
  check("توکن نامعتبر رد می‌شود", wrongRole.status === 403);

  const saved = await call({ token: TOKEN, action: "set", items: { "home.badge": "متن جدید", "home.subtitle": "زیرعنوان جدید" } });
  check("ذخیره با توکن مدیر انجام می‌شود", saved.status === 200 && saved.json.saved === 2);
  check("مقدار در دیتابیس به‌روز شد",
    DB.site_content.find((r) => r.key === "home.badge")?.value === "متن جدید");
  check("کلید جدید اضافه شد",
    DB.site_content.find((r) => r.key === "home.subtitle")?.value === "زیرعنوان جدید");

  const badKey = await call({ token: TOKEN, action: "set", items: { "../../etc/passwd": "x", "home.badge": "ok" } });
  check("کلید غیرمجاز ذخیره نمی‌شود",
    !DB.site_content.some((r) => String(r.key).includes("passwd")));

  const longValue = await call({ token: TOKEN, action: "set", items: { "home.badge": "ا".repeat(20000) } });
  check("متن خیلی بلند بریده می‌شود",
    longValue.status === 200 &&
    DB.site_content.find((r) => r.key === "home.badge").value.length <= 8000);

  const resetOne = await call({ token: TOKEN, action: "reset", keys: ["home.badge"] });
  check("بازگردانی به پیش‌فرض کار می‌کند",
    resetOne.status === 200 && !DB.site_content.some((r) => r.key === "home.badge"));

  const badAction = await call({ token: TOKEN, action: "drop-tables" });
  check("اکشن نامعتبر رد می‌شود", badAction.status === 400);
}

/* ═══════════════════════════════════════════════════════════════
   ۵) پنل ادمین
   ═══════════════════════════════════════════════════════════════ */

console.log("\n── پنل ادمین: تب «محتوای سایت» ──");

const admin = read("admin.html");
const adminJs = read("js/admin-content.js");

check("تب «محتوای سایت» در پنل هست", admin.includes('data-tab="content"'));
check("بخش محتوا در پنل هست", admin.includes('id="sec-content"'));
check("ناحیه‌ی نمایش فیلدها هست", admin.includes('id="content-groups"'));
check("دکمه ذخیره هست", admin.includes('id="content-save"'));
check("جست‌وجو در متن‌ها هست", admin.includes('id="content-search"'));
check("manifest در پنل بارگذاری می‌شود", admin.includes("/js/content-manifest.js"));
check("اسکریپت پنل محتوا بارگذاری می‌شود", admin.includes("/js/admin-content.js"));

check("تب به سیستم تب‌های پنل وصل شده", adminJs.includes("loaders.content"));
check("ذخیره از فانکشن site-content استفاده می‌کند", adminJs.includes('"site-content"'));
check("آپلود عکس از kind: site استفاده می‌کند", adminJs.includes('kind: "site"'));
check("عکس‌ها قبل از آپلود فشرده می‌شوند", adminJs.includes("compressImage"));
check("دکمه بازگشت به پیش‌فرض دارد", adminJs.includes('action: "reset"'));
check("فیلد خالی = پیش‌فرض (به کاربر گفته شده)",
  admin.includes("خالی بگذارید"));

check("migration جدول site_content وجود دارد",
  existsSync(path.join(root, "supabase/migrations/20260924000001_site_content.sql")));

const migration = read("supabase/migrations/20260924000001_site_content.sql");
check("جدول با RLS بسته است", migration.includes("enable row level security"));
check("دسترسی مستقیم کلاینت بسته شده", migration.includes("revoke all"));

check("فانکشن site-content وجود دارد",
  existsSync(path.join(root, "supabase/functions/site-content/index.ts")));

const fn = read("supabase/functions/site-content/index.ts");
check("فانکشن، نقش admin را بررسی می‌کند", fn.includes('user.role !== "admin"'));
check("فانکشن کلیدها را اعتبارسنجی می‌کند", fn.includes("isValidKey"));

/* ═══════════════════════════════════════════════════════════════ */

console.log(`\n${failed === 0 ? "ALL CONTENT CHECKS PASSED ✅" : `${failed} تست شکست خورد ❌`}`);
console.log(`(${passed} تست موفق)`);
process.exit(failed === 0 ? 0 : 1);
