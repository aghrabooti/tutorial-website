# پوشه‌ی deploy

## دیپلوی فانکشن‌ها و مهاجرت دیتابیس

فایل `deploy-functions.github-workflow.yml` نسخه‌ی اصلاح‌شده‌ی ورک‌فلوی
`.github/workflows/deploy-functions.yml` است.

**چرا اینجا و نه مستقیم در `.github/workflows/`؟**
توکن رباتِ ساختِ این تغییرات اجازه‌ی نوشتن روی فایل‌های ورک‌فلو را نداشت؛ پس این
فایل اینجا نگه داشته شده تا خودتان (با یک‌بار کپی) آن را جایگزین کنید:

```bash
cp deploy/deploy-functions.github-workflow.yml .github/workflows/deploy-functions.yml
git add .github/workflows/deploy-functions.yml
git commit -m "ci: deploy all edge functions + run migrations + set gateway secrets"
git push
```

### این ورک‌فلو چه مشکلاتی را حل می‌کند؟

ورک‌فلوی قبلی:

- از برنچ اشتباه چک‌اوت می‌کرد (`arena/01a03446-tutorial-website`) → آخرین اجرا
  (۲۷ آگوست) با شکست در مرحله‌ی دیپلوی تمام شد؛ یعنی نسخه‌ی جدید توابع
  (از جمله ساخت مرسوله‌ی پستی) هرگز روی پروژه دیپلوی نشده بود.
- فقط ۴ فانکشن را دیپلوی می‌کرد و توابع پنل مدیریت
  (`admin-shipments`، `admin-orders`، `admin-overview`) را به‌روز نمی‌کرد.

ورک‌فلوی جدید:

1. از همان برنچی که اجرا شده چک‌اوت می‌کند (`${{ github.ref_name }}`)
2. **همه‌ی** فانکشن‌های `supabase/functions` را دیپلوی می‌کند
3. فایل‌های `supabase/migrations/*.sql` را اجرا می‌کند
   (`scripts/apply-migrations.py` → Management API)
4. در صورت وارد کردن ورودی‌ها، secret های زرین‌پال را تنظیم می‌کند:

| ورودی | نمونه |
|---|---|
| `zarinpal_merchant_id` | `<مرچنت‌کد ۳۶ کاراکتری>` |
| `zarinpal_sandbox` | `false` |
| `zarinpal_callback_url` | `https://mahdiazizi.com/payment-result` |
| `migrate_database` | `true` |

نیاز به secret `SUPABASE_ACCESS_TOKEN` در تنظیمات ریپوزیتوری (Settings → Secrets
and variables → Actions).

### اجرای دستی بدون ورک‌فلو

```bash
supabase functions deploy --project-ref qbsfotperzzhuimnpmto

# مهاجرت دیتابیس (SQL را در SQL Editor پنل Supabase هم می‌توانید اجرا کنید)
SUPABASE_ACCESS_TOKEN=... PROJECT_REF=qbsfotperzzhuimnpmto \
  python3 scripts/apply-migrations.py supabase/migrations/*.sql
```
