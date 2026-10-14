# اجرای نسخه‌ی فعلی، Next.js و APIهای منتقل‌شده

Compose شامل دو سرویس است:

- **Nginx** فایل‌های فعلی HTML/CSS/JS را سرو می‌کند و `/api/*` را به Next.js می‌فرستد.
- **Next.js روی Node.js 22** مسیرهای منتقل‌شده را اجرا می‌کند: `GET /api/courses`، `GET /api/site-content` و routeهای اختصاصی `/api/functions/*` برای داده‌ی عمومی، حساب/نشست، سبد/نشانی/دسترسی و ۱۰ API مدیریت (`admin-get-courses`، `admin-get-sessions`، `admin-users`، `admin-orders`، `admin-create-course`، `admin-update-course`، `admin-save-sessions`، `admin-overview`، `admin-upload-url` و `admin-shipments`). `POST /api/functions/[name]` فقط هفت تابع Edge باقی‌مانده را proxy می‌کند؛ `/api/health` سلامت process را می‌سنجد.

**این هنوز مهاجرت کامل API یا خروج از Supabase نیست.** صفحه‌ها همچنان HTML هستند و دیتابیس/Storage در Supabase می‌مانند. تنها `get-course-file`، `get-course-sessions`، `otp-verify`، `payment-request`، `payment-verify`، `send-otp` و نوشتن `site-content` هنوز Edge-backed هستند. پل سازگاری فقط درخواست را عبور می‌دهد و منطق این توابع را به Next منتقل نمی‌کند. پرداخت هنوز در Edge اجرا می‌شود؛ پورت ۳۰۰۰ فقط داخل شبکه‌ی Docker در دسترس است.

## پیش‌نیاز و تنظیم secretها

- VPS با Docker Engine و Docker Compose plugin؛
- دسترسی به `registry.npmjs.org` هنگام build برای نصب dependencyهای Next.js؛
- reverse proxy محلی برای اتصال به `127.0.0.1:8080`؛
- برای انتشار عمومی، TLS از Caddy یا reverse proxy موجود هاست.

از ریشه‌ی مخزن فایل محلی تنظیمات را بسازید:

```bash
cp .env.example .env
chmod 600 .env
```

سپس در `.env` مقدارهای واقعی `SUPABASE_URL`، `SUPABASE_ANON_KEY` و `SUPABASE_SERVICE_ROLE_KEY` را وارد کنید. **فایل `.env` نباید به Git اضافه یا در چت/لاگ عمومی فرستاده شود.** anon key برای proxy سروری به Edge Functionها و queryهای مجاز استفاده می‌شود؛ service-role فقط در routeهای محدود سمت سرور است. هیچ‌کدام را با پیشوند `NEXT_PUBLIC_` تعریف نکنید.

برای کارت وضعیت درگاه در `admin-overview`، متغیرهای `ZARINPAL_MERCHANT_ID`، `ZARINPAL_SANDBOX`، `ZARINPAL_CALLBACK_URL` و `PRICE_TO_RIAL_FACTOR` را نیز در محیط Next بگذارید و دقیقاً با تنظیم فعال در Edge همسان نگه دارید. این متغیرها فقط برای نمایش وضعیت‌اند؛ **پرداخت همچنان در Edge اجرا می‌شود** و تنظیم این متغیرها به‌تنهایی درگاه را فعال یا منتقل نمی‌کند. در staging از سندباکس استفاده کنید.

- خواندن فهرست دوره‌ها و جزئیات یک دوره از anon key استفاده می‌کند و تابع policyهای فعلی RLS است.
- مسیر عمومی `GET /api/site-content` از service-role فقط برای یک query ثابتِ `SELECT key, value, updated_at` استفاده می‌کند؛ route هیچ ورودی برای انتخاب جدول، فیلتر یا mutation نمی‌پذیرد.
- routeهای حساب/نشست (`login-user`، `register-user`، `update-profile`، `change-password`، `check-session`، `logout-user`) و خرید/نشانی (`add-to-cart`، `get-cart`، `remove-from-cart`، `get-my-address`، `save-shipping-address`، `get-my-courses`، `check-course-access`) از service-role فقط سمت سرور استفاده می‌کنند؛ توکن خام یا کلید دیتابیس به مرورگر برگردانده نمی‌شوند.
- هر ۱۰ route مدیریت ابتدا نشست فعال و نقش مدیر را سمت سرور بررسی می‌کنند. `admin-upload-url` URL امضاشده‌ی Storage می‌دهد و فایل را به هاست مستقل منتقل نمی‌کند.

## ساخت و اجرا در staging

از ریشه‌ی مخزن اجرا کنید. `--env-file .env` صریح است تا Compose فایل ریشه را بخواند. گزینه‌ی `--quiet` از چاپ مقدار secretها در خروجی `config` جلوگیری می‌کند:

```bash
docker compose --env-file .env -f deploy/self-hosted/compose.yaml config --quiet
docker compose --env-file .env -f deploy/self-hosted/compose.yaml build
docker compose --env-file .env -f deploy/self-hosted/compose.yaml up -d
docker compose --env-file .env -f deploy/self-hosted/compose.yaml ps
```

Compose health سرویس Next.js را بررسی می‌کند و سپس Nginx را بالا می‌آورد. Nginx روی `127.0.0.1:8080` bind می‌شود؛ Next.js پورت عمومی ندارد. DNS دامنه‌ها را فقط هنگام cutover تغییر دهید.

## آزمون مسیرها روی همان VPS

```bash
curl -sS -o /dev/null -w 'main /: %{http_code}\n' \
  -H 'Host: mahdiazizi.com' http://127.0.0.1:8080/

curl -sS -o /dev/null -w 'clean URL /courses: %{http_code}\n' \
  -H 'Host: mahdiazizi.com' http://127.0.0.1:8080/courses

curl -sS -o /dev/null -w 'explicit .html component: %{http_code}\n' \
  -H 'Host: mahdiazizi.com' http://127.0.0.1:8080/components/header.html

curl -sS -D - -o /dev/null \
  -H 'Host: admin.mahdiazizi.com' http://127.0.0.1:8080/

curl -fsS -H 'Host: mahdiazizi.com' \
  http://127.0.0.1:8080/api/health

curl -fsS -H 'Host: mahdiazizi.com' \
  http://127.0.0.1:8080/api/courses

curl -fsS -H 'Host: mahdiazizi.com' \
  http://127.0.0.1:8080/api/site-content

curl -sS -o /dev/null -w 'admin login: %{http_code}\n' \
  -H 'Host: admin.mahdiazizi.com' http://127.0.0.1:8080/admin-login
```

انتظار: صفحه‌ها و assetها `200`، ریشه‌ی `admin.mahdiazizi.com` پاسخ `302` با `Location: /admin-login`، و health پاسخ `{"status":"ok","service":"next-api"}` بدهد. `/api/courses` باید JSON با کلیدهای `data` و `error` بدهد؛ `/api/site-content` نگاشت محتوای قابل‌نمایش عمومی را برمی‌گرداند.

برای آزمون جزئیات یک دوره، `COURSE_ID` را با شناسه‌ی واقعی یک دوره جایگزین کنید:

```bash
curl -sS -X POST \
  -H 'Host: mahdiazizi.com' \
  -H 'Content-Type: application/json' \
  --data '{"course_id":"COURSE_ID"}' \
  http://127.0.0.1:8080/api/functions/get-course
```

برای دیدن لاگ‌ها:

```bash
docker compose --env-file .env -f deploy/self-hosted/compose.yaml logs --tail=100 next-app web
```

## توسعه و تست محلی Next.js

تست و build محلی به اتصال زنده به Supabase نیاز ندارند؛ تست‌ها fetchهای Supabase را mock می‌کنند:

```bash
cd apps/next-app
npm ci
npm test
NEXT_TELEMETRY_DISABLED=1 npm run build
npm audit --omit=dev
```

برای اجرای endpointهای وابسته به داده در `npm run dev`، فایل `apps/next-app/.env.local` را جداگانه بسازید و همان متغیرها را آن‌جا قرار دهید؛ این فایل هم نباید commit شود.

## TLS و reverse proxy

نمونه‌ی Caddy در `Caddyfile.example` است. Caddy روی خود VPS (یا reverse proxy فعلی هاست) درخواست دامنه را به `127.0.0.1:8080` می‌فرستد. فایل نمونه نام‌های فعلی را دارد؛ اگر یکی از آن‌ها DNS ندارد، حذفش کنید. برای صدور گواهی عمومی DNS باید به VPS اشاره کند و پورت‌های ۸۰ و ۴۴۳ باز باشند. برای staging نام‌های آزمایشی را جایگزین کنید.

**تا تأیید staging، DNS دامنه‌ی اصلی را تغییر ندهید.** staging را با IP allowlist یا Basic Auth محدود و از index شدن آن جلوگیری کنید؛ canonicalها به دامنه‌ی اصلی اشاره دارند.

## توقف/rollback

```bash
docker compose --env-file .env -f deploy/self-hosted/compose.yaml down
```

این دستور کانتینرهای staging را متوقف می‌کند و به Vercel، Supabase یا داده‌هایشان دست نمی‌زند. در صورت cutover ناموفق، DNS را به مقصد قبلی برگردانید؛ سرویس‌های قبلی را تا پایان دوره‌ی پایش روشن نگه دارید.

## چه چیزهایی هنوز منتقل نشده‌اند؟

- صفحه‌های سایت هنوز همان HTMLهای فعلی‌اند، نه pageهای Next.js.
- APIهای عمومی، حساب/نشست، سبد/نشانی/دسترسی و ۱۰ API مدیریت route اختصاصی Next دارند؛ همه‌ی `apiCall`ها از same-origin عبور می‌کنند.
- فقط هفت تابع هنوز Edge-backed هستند: `get-course-file`، `get-course-sessions`، `otp-verify`، `payment-request`، `payment-verify`، `send-otp` و نوشتن `site-content`. proxy صرفاً درخواست را عبور می‌دهد و backend آن‌ها را منتقل نمی‌کند. ثبت‌نام همچنان اول OTP را verify می‌کند و بعد `register-user` را اجرا می‌کند.
- query مستقیم فهرست محصولات از `js/admin.js` و Supabase JS SDK از `admin.html` حذف شده‌اند.
- دیتابیس و Storage هنوز Supabase هستند؛ `admin-upload-url` هم فقط URL امضاشده‌ی Storage فعلی را می‌دهد. انتقال فایل، پیامک و منطق پرداخت انجام نشده و CDN فونت‌ها/کتابخانه‌ها نیز هنوز استفاده می‌شود.
- Docker/Nginx و اتصال به Supabase زنده در این محیط آزمایش نشده‌اند؛ build و اجرای کانتینر و smoke test روی VPS باید جداگانه انجام شود.
