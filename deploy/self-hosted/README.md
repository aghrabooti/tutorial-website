# اجرای سایت روی میزبان داخلی

این استقرار شامل Nginx برای صفحه‌های سایت، Next.js برای APIها، PostgreSQL برای داده‌ها و PostgREST برای ارتباط خصوصی Next.js با دیتابیس است. فایل‌های دوره و تصاویر روی volume محلی ذخیره می‌شوند. مرورگر فونت، Tailwind و آیکون‌ها را از خود سایت می‌گیرد. PostgreSQL و PostgREST هیچ پورتی روی میزبان منتشر نمی‌کنند و Next.js تنها از طریق Nginx در دسترس است.

پرداخت از زرین‌پال و ثبت‌نام پیامکی از sms.ir یا کاوه‌نگار استفاده می‌کند. دسترسی به آن‌ها و به سرویس‌های مورد استفاده در لینک کلاس‌ها و ویدیوهای فعلی به شبکهٔ مقصد بستگی دارد.

## ساخت و انتقال به هاست داخلی

این دستورات برای میزبان لینوکسی با Docker Compose هستند. متغیرهای رمز و امضای فایل را با سه مقدار مستقل از خروجی `openssl rand -hex 32` پر کنید. رمز `DATABASE_API_PASSWORD` در URI اتصال استفاده می‌شود و باید هگز باشد. برای پرداخت واقعی، `ZARINPAL_CALLBACK_URL` را روی آدرس HTTPS صفحهٔ `/payment-result` در دامنهٔ عمومی قرار دهید. برای تنظیم پیامک، مقادیر مربوط به یک ارائه‌دهنده را در `.env` وارد کنید.

روی دستگاه متصل، ایمیج‌ها را برای معماری سرور مقصد آماده کنید.

```sh
cp .env.example .env
chmod 600 .env
docker compose --env-file .env -f deploy/self-hosted/compose.yaml config --quiet
docker compose --env-file .env -f deploy/self-hosted/compose.yaml pull db db-api
docker compose --env-file .env -f deploy/self-hosted/compose.yaml build web next-app
docker image save -o tutorial-images.tar \
  tutorial-web:local tutorial-next:local postgres:17-alpine postgrest/postgrest:v12.2.12
```

فایل ایمیج، پوشهٔ ریپو و تنظیمات سرور را امن به میزبان منتقل کنید. روی میزبان:

```sh
docker image load -i tutorial-images.tar
docker compose --env-file .env -f deploy/self-hosted/compose.yaml up -d --no-build --pull never
docker compose --env-file .env -f deploy/self-hosted/compose.yaml ps
curl -fsS http://127.0.0.1:8080/api/health
```

پورت `8080` فقط روی loopback میزبان باز است. DNS دامنهٔ سایت و زیردامنهٔ مدیر باید از داخل شبکهٔ ایران به میزبان برسد. reverse proxy میزبان را به پورت `8080` وصل کنید و گواهی قابل‌اعتماد مرورگر را پیش از قطعی آماده و تمدید آن را آزمایش کنید. [نمونهٔ Caddy](Caddyfile.example) پیکربندی اولیهٔ reverse proxy را نشان می‌دهد.

## انتقال دیتابیس و فایل‌های نسخهٔ فعال

نسخهٔ پشتیبان کامل دیتابیس و Storage مبدأ را جداگانه بگیرید. ابزار زیر جدول‌های مورد استفادهٔ برنامه را از طریق `psql` خروجی می‌گیرد و به‌صورت اختیاری تصاویر و PDFها را هم دانلود می‌کند. اتصال مبدأ را با `PGHOST`، `PGPORT`، `PGUSER`، `PGDATABASE`، `PGSSLMODE=require` و `PGPASSFILE` تنظیم کنید. برای خروجی فایل‌ها، `LEGACY_STORAGE_URL` و `LEGACY_STORAGE_KEY` را فقط در محیط همان فرایند قرار دهید. این مقادیر در تنظیمات Compose مقصد کاربردی ندارند.

```sh
umask 077
python3 deploy/self-hosted/transfer-data.py export /secure/tutorial-export --include-files
```

بار اول روی استقرار آزمایشی با دیتابیس خالی اجرا کنید. برای انتقال نهایی، پس از اتمام پرداخت‌های در جریان و توقف نوشتن روی سامانهٔ مبدأ، خروجی تازه بگیرید. تغییر دامنه پس از تأیید بازیابی انجام می‌شود.

```sh
umask 077
export_path=/secure/tutorial-export
python3 deploy/self-hosted/transfer-data.py restore-sql "$export_path" > "$export_path/restore.sql"
dc() { docker compose --env-file .env -f deploy/self-hosted/compose.yaml "$@"; }

# دادهٔ کاربران هنگام بازیابی در یک تراکنش وارد می‌شود.
dc exec -T db mkdir -m 700 /tmp/tutorial-restore
(cd "$export_path" && tar -cf - restore.sql ./*.csv) | \
  dc exec -T db tar -C /tmp/tutorial-restore -xf -
dc exec -T db sh -c 'cd /tmp/tutorial-restore && psql -X -v ON_ERROR_STOP=1 -U postgres -d tutorial -f restore.sql'

# فایل‌ها با همان کلید قبلی به volume محلی برمی‌گردند.
if [ -d "$export_path/files" ]; then
  dc cp "$export_path/files/." next-app:/app/var/files
  dc exec -T -u root next-app chown -R nextjs:nodejs /app/var/files
fi
```

پس از بازیابی موفق، کپی موقت CSV را از کانتینر پاک کنید. روی یک نمونهٔ جداگانه نتیجهٔ بازیابی را با تعداد رکوردهای مبدأ، چند سفارش قدیمی و دانلود PDF خریداران مقایسه کنید. ابزار URLهای استاندارد تصاویر قدیمی را به مسیر محلی تبدیل می‌کند. لینک‌های سفارشی دامنه‌های دیگر را به‌صورت جداگانه بررسی کنید.

حساب‌های منتقل‌شده شناسه، هش رمز، نشست و نقش قبلی را حفظ می‌کنند. در استقرار خالی، ابتدا حساب را با شمارهٔ تأییدشده ثبت کنید و از داخل `psql` نقش همان شماره را به `admin` تغییر دهید.

## پذیرش استقرار

- `/api/health` باید پس از دسترسی به دیتابیس پاسخ ۲۰۰ بدهد.
- از شبکهٔ مقصد، با اینترنت بین‌الملل مسدود، صفحهٔ اصلی، لیست دوره‌ها، ثبت‌نام و ورود، پنل مدیریت و آپلود تصویر را باز کنید.
- درخواست پرداخت، بازگشت از درگاه، ثبت سفارش و دانلود PDF خریدار را آزمایش کنید. دانلود PDF بدون مجوز باید رد شود.
- از دیتابیس و volume فایل‌ها جداگانه نسخهٔ پشتیبان بگیرید و بازیابی هر دو را آزمایش کنید.
