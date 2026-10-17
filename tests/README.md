# تست‌های محلی (بدون نیاز به Supabase)

تست‌های legacy این پوشه بعضی از سورس‌های Supabase Edge را با یک **دیتابیس درون‌حافظه‌ای** و یک **زرین‌پال تقلبی** اجرا می‌کنند؛ این به معنی فعال‌بودن Edge در مسیر مرورگر نیست. هیچ درخواست واقعی به Supabase یا زرین‌پال زده نمی‌شود.

```bash
cd tests
npm ci             # نصب تکرارپذیر (esbuild + jsdom + PGlite)
npm test
```

| تست | چه چیزی را بررسی می‌کند |
|---|---|
| `postgres-schema.test.mjs` | migration پایه را در PGlite/WASM اجرا می‌کند؛ ساخت ۱۱ جدول، readiness، نقش محدود برنامه، DML، UUID، trigger، constraint و cascade را بررسی می‌کند. این بررسی جای PostgreSQL واقعی/Docker را نمی‌گیرد. |
| `api-migration.test.mjs` | نگاشت هم‌مبدأ Next برای همه‌ی APIهای فعلی مرورگر، شامل هفت API منتقل‌شده‌ی آخر؛ ابزارهای OTP/profile هم route اختصاصی را می‌زنند و پراکسی Edge allowlist خالی دارد |
| `shipments.test.mjs` | خودترمیمی مرسوله‌های جامانده، عدم ساخت مرسوله برای سفارش‌های دیجیتال/پرداخت‌نشده، گزارش سفارش پستی بدون نشانی همراه شماره تماس، idempotent بودن `resync`، `mark_sent`، کنترل دسترسی مدیر، نمایش خطای دیتابیس |
| `payments.test.mjs` | با mock بررسی می‌کند production به میزبان زرین‌پال واقعی (`payment.zarinpal.com`) اشاره کند؛ ساخت مرسوله پس از پرداخت موفق، اقلام دیجیتال، تشخیص sandbox از روی `authority`، تلاش روی محیط دیگر، خطای مرچنت‌کد و الزام نشانی برای محصول فیزیکی |
| `admin-panel.test.cjs` | رندر تب‌های پنل مدیریت (کارت وضعیت درگاه، ستون «ارسال پستی»، هشدار مرسوله‌های جامانده و فیلترها) با پاسخ‌های نمونه |

تست‌های routeهای Next.js و build آن‌ها مستقل از این مجموعه اجرا می‌شوند:

```bash
cd apps/next-app
npm ci
npm test
npm run build
```

تست‌های `apps/next-app/test/` pool/queryهای PostgreSQL و providerهای SMS/زرین‌پال را mock می‌کنند و به secret یا پروژه‌ی واقعی نیاز ندارند. علاوه بر auth، سبد و مدیریت، `course-entitlements.test.js` مالکیت خرید/URL و زمان‌بندی جلسه‌ها، `otp-flows.test.js` OTP و fail-closed بودن production، و `payments.test.js` ساخت/تأیید سفارش و مرسوله را بررسی می‌کنند. آزمون mock جای PostgreSQL یا staging زنده را نمی‌گیرد.

نحوه‌ی کار: `build.mjs` هر فانکشن را با esbuild باندل می‌کند، ایمپورت
`https://esm.sh/@supabase/supabase-js@2` را با `supabase-stub.js` جایگزین و
`Deno.env` را با `deno-shim.js` شبیه‌سازی می‌کند. خروجی باندل‌ها در
`tests/.build/` ساخته می‌شود (در گیت نگه داشته نمی‌شود).
