# راهنمای راه‌اندازی — گام به گام (بدون نصب هیچ نرم‌افزاری)

هدف: ۱) خرید کتاب/جزوه حتماً در تب «مرسوله‌های پستی» پنل مدیریت دیده شود،
۲) درگاه پرداخت روی حالت **واقعی** باشد.

---

## گام ۰ — روشن کردن درگاه واقعی در Supabase (۲ دقیقه)

۱. وارد `supabase.com` شوید و پروژه را باز کنید.
۲. از منوی پایین‌سمت‌چپ: **Project Settings → Edge Functions → Secrets**
   (مسیر جایگزین: **Project Settings → Functions** و سپس بخش Secrets).
۳. سه مقدار زیر را اضافه کنید (دکمه‌ی **Add new secret**):

| Name (نام) | Value (مقدار) |
|---|---|
| `ZARINPAL_MERCHANT_ID` | مرچنت‌کد ۳۶ کاراکتری خودتان از پنل `my.zarinpal.com` |
| `ZARINPAL_SANDBOX` | `false` |
| `ZARINPAL_CALLBACK_URL` | `https://mahdiazizi.com/payment-result` |

> نکته: اگر `ZARINPAL_SANDBOX` را ست نکنید، **نسخه‌ی قدیمی** کد روی سندباکس
> می‌ماند؛ پس حتماً این خط را با مقدار `false` اضافه کنید.
> (بعد از دیپلوی نسخه‌ی جدید، پیش‌فرض خودش `false` می‌شود.)
>
> `PRICE_TO_RIAL_FACTOR` هم اگر قبلاً ست نشده، مقدار `10` بگذارید (قیمت‌ها تومان است).

---

## گام ۱ — به‌روز کردن ورک‌فلوی دیپلوی (۲ دقیقه، فقط کپی/پیست)

توکن رباتی که این تغییرات را نوشته اجازه‌ی دست‌زدن به فایل‌های ورک‌فلو را ندارد؛
پس این یک فایل را خودتان جای‌گذاری کنید:

۱. این فایل را در گیت‌هاب باز کنید و **کل متنش** را کپی کنید:
   `deploy/deploy-functions.github-workflow.yml`
   لینک:
   `https://github.com/aghrabooti/tutorial-website/blob/arena/01a0c454-tutorial-website/deploy/deploy-functions.github-workflow.yml`

۲. این لینک را باز کنید (ویرایش ورک‌فلوی فعلی):
   `https://github.com/aghrabooti/tutorial-website/edit/main/.github/workflows/deploy-functions.yml`

۳. کل متن قبلی را پاک کنید، متن کپی‌شده را بچسبانید و **Commit changes** بزنید.

> ورک‌فلوی قبلی از یک برنچ اشتباه چک‌اوت می‌کرد (`arena/01a03446-...`) و به همین
> دلیل اجرای ۲۷ آگوست شکست خورد و فقط ۴ فانکشن را دیپلوی می‌کرد. نسخه‌ی جدید
> از همان برنچی که اجرا می‌شود چک‌اوت می‌کند و **همه‌ی** فانکشن‌ها را دیپلوی می‌کند.

---

## گام ۲ — ساخت توکن Supabase و افزودن آن به گیت‌هاب (۳ دقیقه، یک‌بار برای همیشه)

۱. توکن بسازید: `https://supabase.com/dashboard/account/tokens` →
   **Generate new token** → کپی کنید.
۲. در گیت‌هاب: `https://github.com/aghrabooti/tutorial-website/settings/secrets/actions`
   → **New repository secret**
   - Name: `SUPABASE_ACCESS_TOKEN`
   - Secret: توکنی که کپی کردید
   → **Add secret**

> اگر این توکن قبلاً وجود دارد، این گام لازم نیست و می‌توانید رد شوید.

---

## گام ۳ — اجرای دیپلوی (۱ دقیقه)

۱. برو به `https://github.com/aghrabooti/tutorial-website/actions`
۲. روی **Deploy Supabase Edge Functions** کلیک کنید → دکمه‌ی **Run workflow**.
۳. ورودی‌ها را خالی بگذارید (چون secret های گام ۰ را خودتان ست کرده‌اید) و
   **Run workflow** را بزنید.
   > اگر می‌خواهید مرچنت‌کد از همین‌جا هم ست شود، همان ورودی‌ها را پر کنید:
   > `zarinpal_merchant_id`، `zarinpal_sandbox = false`،
   > `zarinpal_callback_url = https://mahdiazizi.com/payment-result`،
   > `migrate_database = true`
۴. منتظر بمانید تا چراغ سبز شود (حدود ۱ تا ۲ دقیقه). این اجرا:
   - همه‌ی فانکشن‌های پوشه‌ی `supabase/functions` را دیپلوی می‌کند
   - مهاجرت دیتابیس (`supabase/migrations/*.sql`) را اجرا می‌کند
     (ایمن است و چیزی حذف نمی‌کند)

---

## گام ۴ — بررسی نتیجه

۱. پنل مدیریت (`admin.mahdiazizi.com`) → تب **داشبورد**:
   باید کارت «وضعیت درگاه پرداخت» را ببینید:
   - سبز: **زرین‌پال — درگاه واقعی ✅** (یعنی درگاه واقعی فعال است)
   - اگر زرد بود، یعنی یکی از secret های گام ۰ جا افتاده (مرچنت‌کد یا سندباکس).
۲. تب **مرسوله‌های پستی**:
   - خریدهای قبلی کتاب/جزوه که مرسوله نداشتند، **خودکار** ساخته و نمایش داده می‌شوند.
   - اگر مشتری‌ای نشانی ثبت نکرده باشد، کارت قرمز «بدون مرسوله ⚠️» با شماره‌ی
     تماس او نمایش داده می‌شود.
   - دکمه‌ی **«ساخت مرسوله‌های جامانده»** همین کار را دستی هم انجام می‌دهد.
۳. تب **سفارش‌ها**: ستون جدید «ارسال پستی» وضعیت هر سفارش را نشان می‌دهد.
۴. یک خرید آزمایشی با مبلغ کم بکنید و مسیر «کتاب → نشانی → درگاه واقعی → مرسوله»
   را یک‌بار ببینید.

---

## اگر ترجیح می‌دهید از GitHub استفاده نکنید — روش دستی

```bash
# ۱) دیپلوی همه‌ی فانکشن‌ها
supabase functions deploy --project-ref qbsfotperzzhuimnpmto

# ۲) مهاجرت دیتابیس (یا کل فایل SQL را در Supabase → SQL Editor اجرا کنید)
SUPABASE_ACCESS_TOKEN=... PROJECT_REF=qbsfotperzzhuimnpmto \
  python3 scripts/apply-migrations.py supabase/migrations/*.sql
```

یا از پنل Supabase: **Edge Functions** → هر فانکشن را باز کنید → متن
`supabase/functions/<name>/index.ts` را بچسبانید → **Deploy**.
(برای رفع مشکل مرسوله‌ها حتماً `payment-verify`، `payment-request`،
`admin-shipments`، `admin-orders` و `admin-overview` را به‌روز کنید.)

---

## چرا این تغییرات لازم بود؟ (خلاصه‌ی فنی)

1. آخرین دیپلوی (۲۷ آگوست) شکست خورده بود → کد جدید توابع هرگز روی سایت فعال نشد.
2. ساخت مرسوله در `payment-verify` به یک constraint یکتا وابسته بود و خطایش هم
   لاگ نمی‌شد → درج بی‌صدا شکست می‌خورد و مرسوله‌ای ساخته نمی‌شد.
3. اگر نشانی مشتری نبود، هیچ‌جای پنل چیزی نشان نمی‌داد → سفارش از قلم می‌افتاد.

هر سه مورد بسته شد: ساخت مرسوله بدون وابستگی به constraint + خودترمیمی
خریدهای قبلی + نمایش هشدار برای موارد ناقص، به‌همراه پیش‌فرض درگاه واقعی و
کارت وضعیت درگاه در داشبورد.
