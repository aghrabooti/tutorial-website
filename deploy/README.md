# راهنمای استقرار

## مسیر فعال: self-hosted

برای اجرای Next.js، Nginx، PostgreSQL و Storage محلی از [`self-hosted/README.md`](self-hosted/README.md) و فایل [`.env.example`](../.env.example) استفاده کنید. پس از بارگذاری مخزن روی Ubuntu 24.04 x86_64، `sudo env CREATE_INITIAL_ADMIN=1 bash deploy/self-hosted/bootstrap-ubuntu.sh` در صورت نیاز Docker Engine/Compose v2 را نصب و stack را بالا می‌آورد. وب روی `127.0.0.1:8080` در دسترس محلی است؛ reverse proxy عمومی و TLS در این مخزن بسته‌بندی نشده‌اند و برای دسترسی عمومی باید جداگانه تنظیم شوند. DNS/فایروال و کلیدهای SMS/Zarinpal باید جداگانه تنظیم شوند؛ مسیر واقعی VPS هنوز validate نشده است. مراحل rollout، backup/rollback و blockerها در [`../docs/migration-to-self-hosted.md`](../docs/migration-to-self-hosted.md) و [`../docs/deployment-readiness.md`](../docs/deployment-readiness.md) هستند.

APIهای فعال از PostgreSQL می‌خوانند/می‌نویسند؛ فایل‌ها در volume محلی هستند و پیامک/زرین‌پال providerهای بیرونی‌اند. Runtime به Supabase URL یا key نیاز ندارد. در production، ثبت‌نام OTP بدون provider پیامک fail-closed است.

## کد قدیمی Supabase Edge

`.github/workflows/deploy-functions.yml` عمداً غیرفعال است؛ `deploy/deploy-functions.github-workflow.yml`، `scripts/apply-migrations.py` و کدهای `supabase/functions/` فقط legacy/rollback reference هستند. Deploy کردن Edge Functionها یا اجرای migrationهای قدیمی برای راه‌اندازی مقصد PostgreSQL لازم نیست و migration مقصد را نباید روی پروژه‌ی Supabase اجرا کرد.

از workflow قدیمی برای deploy عادی، مهاجرت دیتابیس یا rollback استفاده نکنید. هر cutover/rollback باید پس از backup، restore drill، drain کردن پرداخت‌های در جریان و runbook جداگانه انجام شود. پراکسی سازگاری `/api/functions/[name]` allowlist خالی و fail-closed دارد.
