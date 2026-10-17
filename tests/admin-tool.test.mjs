// تست روش امن ساخت مدیر اولیه در self-hosted deployment.
// اجرا: node tests/admin-tool.test.mjs
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
let failed = 0;
let passed = 0;

function check(label, ok) {
  if (ok) {
    passed++;
    console.log(`✅ ${label}`);
  } else {
    failed++;
    console.log(`❌ ${label}`);
  }
}

const toolPath = path.join(root, "tools/make-admin.html");
const tool = read("tools/make-admin.html");
const bootstrap = read("apps/next-app/scripts/create-admin.js");

console.log("── راهنمای bootstrap مدیر ──");
check("صفحه‌ی ابزار وجود دارد", existsSync(toolPath));
check("صفحه فارسی و RTL است", tool.includes('lang="fa" dir="rtl"'));
check("روش قدیمیِ تولید SQL بازنشسته اعلام شده", tool.includes("فرم مرورگری و تولید SQL این صفحه بازنشسته شده است"));
check("صفحه دستور Compose تعاملی را نشان می‌دهد", tool.includes("exec -it next-app") && tool.includes("scripts/create-admin.js"));
check("صفحه رمز یا شماره را در فرم مرورگر نمی‌گیرد", !/<input\b/i.test(tool));
check("ابزار قدیمی SQL یا رمزhashing را اجرا نمی‌کند", !tool.includes("AdminHash") && !tool.includes("INSERT INTO public.site_users"));

console.log("\n── محافظت‌های bootstrap سمت سرور ──");
check("bootstrap به DATABASE_URL نیاز دارد", bootstrap.includes("process.env.DATABASE_URL"));
check("رمز را فقط با TTY تعاملی می‌گیرد", bootstrap.includes("input.isTTY") && bootstrap.includes("setRawMode(true)"));
check("رمز اولیه حداقل ۱۲ نویسه است", bootstrap.includes("password.length < 12"));
check("رمز را دوبار تأیید می‌کند", bootstrap.includes("password !== confirmation"));
check("مدیر موجود را دوباره نمی‌سازد", bootstrap.includes("role = 'admin'") && bootstrap.includes("bootstrap فقط برای دیتابیس بدون مدیر"));
check("شماره‌ی تکراری را ارتقا یا بازنویسی نمی‌کند", bootstrap.includes("اسکریپت هیچ حسابی را ارتقا یا بازنویسی نمی‌کند"));
check("از PBKDF2 helper سمت سرور استفاده می‌کند", bootstrap.includes('from "../lib/password-hash.js"'));

console.log("\n── راهنمای diagnostic پروفایل ──");
const doctor = read("tools/profile-doctor.html");
check("profile doctor به Supabase credential وابسته نیست", !/SUPABASE_|supabase\.co|Supabase → SQL/i.test(doctor));
check("profile doctor به PostgreSQL/migration اشاره می‌کند", doctor.includes("PostgreSQL") && doctor.includes("DATABASE_URL"));

console.log(`\nنتیجه: ${passed} موفق، ${failed} ناموفق.`);
process.exit(failed === 0 ? 0 : 1);
