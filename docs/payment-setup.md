# راه‌اندازی پرداخت زرین‌پال و ارسال پستی

این راهنما تنظیم routeهای فعال Next.js را توضیح می‌دهد. کدهای Supabase Edge قدیمی در مخزن باقی مانده‌اند، اما مسیر فعال مرورگر نیستند و secretهای Edge به‌تنهایی routeهای Next را پیکربندی نمی‌کنند.

| کار | مسیر فعال |
|---|---|
| ساخت سفارش و شروع پرداخت | `apps/next-app/app/api/functions/payment-request/route.js` |
| تأیید پرداخت و ساخت مرسوله | `apps/next-app/app/api/functions/payment-verify/route.js` |
| وضعیت درگاه در پنل | route `admin-overview` در Next، با همان تنظیم‌های زرین‌پال |
| صفحه‌ی بازگشت از درگاه | `payment-result.html` + `js/payment-result.js` |
| لیست و مدیریت مرسوله‌ها | route `admin-shipments` در Next + تب «مرسوله‌های پستی» در `admin.html` |
| schema سفارش/مرسوله | `apps/next-app/db/migrations/0001_initial_schema.sql` و runner self-hosted |

## ۱) متغیرهای محیط سرور

مقدارها را در محیطی بگذارید که **Next.js** را اجرا می‌کند. برای Compose، فایل `.env.example` را به `.env` محلی تبدیل کنید و Compose را با `--env-file .env` اجرا کنید؛ نمونه‌ی کامل در [`deploy/self-hosted/README.md`](../deploy/self-hosted/README.md) است.

| متغیر | مقدار |
|---|---|
| `DATABASE_URL` | اتصال private به PostgreSQL role محدود برنامه؛ داخل Compose از host `db` استفاده می‌شود |
| `ZARINPAL_MERCHANT_ID` | مرچنت‌کد ۳۶ کاراکتری/UUID زرین‌پال |
| `ZARINPAL_SANDBOX` | برای staging مقدار `true`؛ فقط پس از آزمون برای production مقدار `false` |
| `ZARINPAL_CALLBACK_URL` | آدرس عمومی بازگشت، مانند `https://example.com/payment-result` |
| `PRICE_TO_RIAL_FACTOR` | اگر قیمت DB به تومان است `10`؛ اگر به ریال است `1` |

Runtime self-hosted به Supabase URL/anon/service-role نیاز ندارد؛ dependency و routeهای فعال از آن جدا شده‌اند. کلیدهای Zarinpal فقط در environment سرور باشند، نه `NEXT_PUBLIC_*`. بعد از تغییر environment، سرویس Next را restart/redeploy کنید.

### Staging و production

- ابتدا روی staging با `ZARINPAL_SANDBOX=true` کار کنید. `payment-request` در هر دو حالت مرچنت‌کد UUID-مانند و آدرس callback می‌خواهد؛ callback سندباکس هم باید مقدار داشته باشد. مرچنت تستی `00000000-0000-0000-0000-000000000000` نیز به‌طور خودکار سندباکس را انتخاب می‌کند.
- برای پرداخت واقعی، مرچنت‌کد واقعی را تنظیم کنید، `ZARINPAL_SANDBOX=false` بگذارید و callback را روی HTTPS و دامنه‌ی ثبت‌شده در زرین‌پال قرار دهید. اگر مرچنت‌کد یا callback نامعتبر باشد، شروع پرداخت fail-closed می‌شود؛ به‌جای پیکربندی ناقص، به سندباکس بی‌صدا نمی‌افتد.
- `admin-overview` از همین environment استفاده می‌کند؛ کارت وضعیت، صرفاً آینه‌ی secretهای Edge نیست.
- هرگز از صفحه‌ی staging پرداخت واقعی نگیرید. قبل از فعال‌سازی production، callback، مبلغ و سفارش را روی سندباکس بررسی کنید.

## ۲) مسیر کامل خرید فیزیکی

قاعده‌ی تشخیص محصول فیزیکی (در routeهای پرداخت و مدیریت مرسوله):

```text
courses.requires_shipping = true  یا  courses.type ∈ { book, lecture }
```

1. کاربر محصول را به سبد می‌افزاید و «ادامه پرداخت» را می‌زند.
2. اگر محصول فیزیکی باشد و نشانی تأییدشده وجود نداشته باشد، `payment-request` پاسخ `needs_address: true` می‌دهد و مرورگر کاربر را به `/shipping-address` هدایت می‌کند.
3. پس از ثبت/تأیید نشانی، درخواست پرداخت تکرار می‌شود. قیمت و مشخصات هر محصول از دیتابیس خوانده و در سفارش snapshot می‌شود؛ قیمت ارسالی مرورگر مبنای پرداخت نیست.
4. پس از پرداخت، `payment-verify` مرجع زرین‌پال را بررسی می‌کند، سفارش را `paid` می‌کند و برای سفارش فیزیکی از نشانی کاربر مرسوله می‌سازد. تأیید تکراری idempotent است و نباید دسترسی/مرسوله‌ی تکراری ایجاد کند.
5. `admin-shipments` سفارش‌های فیزیکی پرداخت‌شده‌ی قدیمی را هم بررسی می‌کند و در صورت نیاز مرسوله را خودترمیم می‌کند؛ سفارش بدون نشانی برای رسیدگی مدیر گزارش می‌شود.

## ۳) schema دیتابیس

در مقصد self-hosted، runner فایل `apps/next-app/db/migrations/0001_initial_schema.sql` را روی PostgreSQL مستقل اجرا می‌کند؛ آن را روی پروژه‌ی Supabase اجرا نکنید. schema از inventory ساختاری بازسازی شده و هنوز با PostgreSQL واقعی validate نشده است. روی staging disposable از صفر اجرا کنید، constraintها/نوع ستون‌ها را بررسی کنید و پیش از production backup/restore drill بگذرانید. دیتابیس خالی پذیرفته شده، اما مدیر و حداقل یک دوره باید از پنل ساخته شوند.

## ۴) اجرا و بررسی

برای اجرای Next و Nginx از دستورهای `deploy/self-hosted/README.md` پیروی کنید. مسیرهای مرورگر هم‌مبدأ هستند:

- `POST /api/functions/payment-request`
- `POST /api/functions/payment-verify`
- `POST /api/functions/admin-shipments`
- `POST /api/functions/admin-overview`

تغییر محیط پس از deploy را با restart سرویس اعمال کنید. `supabase/functions/payment-request` و `payment-verify` فقط نسخه‌های قدیمی Edge هستند؛ برای فعال‌کردن routeهای Next نیازی به deploy مجدد Edge Function یا ذخیره‌ی متغیرهای پرداخت در Secrets آن نیست.

آزمون محلی با mock:

```bash
cd apps/next-app
npm test
npm run build
```

پیش از cutover، در staging واقعی این سناریوها را با زرین‌پال sandbox انجام دهید:

- خرید دیجیتال و خرید کتاب/جزوه؛
- ردشدن checkout فیزیکی بدون نشانی؛
- callback موفق، انصراف/پرداخت ناموفق و refresh صفحه‌ی نتیجه؛
- تکرار verify بدون ساخت سفارش/مرسوله‌ی اضافی؛
- تطبیق `orders.amount_rial`, `status`, `authority`, `ref_id` و اطلاعات `shipments`.

تست‌های محلی به سرویس زنده وصل نمی‌شوند؛ آزمون staging و بررسی logها پیش از فعال‌سازی درگاه واقعی الزامی است.
