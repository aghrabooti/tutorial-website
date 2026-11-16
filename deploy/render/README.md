# اجرای نسخهٔ آزمایشی در Render

در [داشبورد Render](https://dashboard.render.com/) گزینهٔ **New → Blueprint** را بزنید، مخزن `aghrabooti/tutorial-website` و شاخهٔ `independent-hosting` را انتخاب کنید و پیش از Deploy بررسی کنید که هر دو منبع روی **Free** باشند. فایل `render.yaml` در ریشهٔ شاخه قرار دارد.

Blueprint یک Web Service و یک PostgreSQL در فرانکفورت می‌سازد. PostgreSQL از طریق شبکهٔ خصوصی Render در دسترس است. کارکرد سرویس با `/api/health` بررسی می‌شود. دیتابیس تازه هنگام شروع یک دورهٔ نمونه می‌گیرد. پس از موفقیت Deploy، آدرس `onrender.com` را باز کنید و صفحهٔ اصلی، `/courses` و `/api/health` را بررسی کنید.

برای تست پرداخت، حالت سندباکس فعال است. مرچنت آزمایشی را در `ZARINPAL_MERCHANT_ID` و آدرس کامل `/payment-result` همین محیط را در `ZARINPAL_CALLBACK_URL` بگذارید. برای ثبت‌نام پیامکی نیز باید تنظیمات sms.ir یا کاوه‌نگار را در بخش Environment وارد کنید.

فایل‌های آپلودشده روی پلن رایگان با خاموشی، restart یا Deploy از بین می‌روند. PostgreSQL رایگان بعد از ۳۰ روز منقضی می‌شود و هر workspace فقط می‌تواند یک دیتابیس رایگان فعال داشته باشد. این محیط را با دادهٔ آزمایشی استفاده کنید. برای تست شبکهٔ داخلی ایران از [روش استقرار روی VPS](../self-hosted/README.md) استفاده کنید.
