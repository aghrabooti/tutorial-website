# tutorial-website
a website for selling tutorial packages

## میزبانی مستقل

وضعیت انتقال runtime از Supabase به PostgreSQL و Storage محلی، برنامه‌ی staging/cutover و blockerها در [راهنمای مهاجرت](docs/migration-to-self-hosted.md) و [فهرست آمادگی استقرار](docs/deployment-readiness.md) آمده است. پس از بارگذاری مخزن روی Ubuntu 24.04 x86_64 می‌توان Docker را نصب و stack را با `sudo env CREATE_INITIAL_ADMIN=1 bash deploy/self-hosted/bootstrap-ubuntu.sh` راه‌اندازی کرد؛ کد وب روی `127.0.0.1:8080` گوش می‌دهد و برای دسترسی عمومی باید reverse proxy موجود VPS یا provider جداگانه تنظیم شود. دامنه‌های فعلی تغییر نمی‌کنند و کلیدهای SMS/Zarinpal باید جداگانه تنظیم شوند. جزئیات در [راهنمای self-hosted](deploy/self-hosted/README.md).
