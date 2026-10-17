# موجودی مرحله‌ی ۵ — انتقال دیتابیس از Supabase به PostgreSQL مستقل

## وضعیت و منبع اطلاعات

کاربر خروجی یک query فقط‌ساختاری را از Supabase SQL Editor فرستاده است. این خروجی ۱۱ جدول schema عمومی، ستون‌ها، defaultها، nullability، constraintها، indexها، وضعیت RLS و policyها، table grantها و triggerها را پوشش می‌دهد؛ **هیچ ردیف یا داده‌ی کاربری ارسال نشده است**.

این خروجی معادل `pg_dump --schema-only` کامل نیست؛ commentها و بعضی dependencyهای جانبی هنوز بررسی نشده‌اند. تعریف functionها، extensionها و نسخه‌ی مبدأ دریافت شده‌اند. مبدأ PostgreSQL 17.6 است و هدف اولیه را PostgreSQL 17.x می‌گیریم. بر پایه‌ی baseline، migration اولیه، pool/transaction helper و runner نسخه‌بندی‌شده اضافه شده‌اند. اکنون ۳۱ route/handler از queryهای PostgreSQL استفاده می‌کنند: دو route عمومی دوره؛ شش route حساب/نشست؛ دو route OTP؛ دو route محتوا؛ هفت route سبد/نشانی/دسترسی؛ دو route جلسه/فایل؛ و ده route مدیریت (از جمله احراز مدیر و upload URL). دو مسیر API دیگر برای Storage و دو health route نیز از backendهای محلی/PG استفاده می‌کنند. مستقیم‌ترین مصرف‌کننده‌ی Supabase از runtime Next حذف شده و پراکسی Edge allowlist خالی دارد. تست‌های mock مربوط به این مسیرها اجرا شده‌اند، اما migration با PostgreSQL واقعی/کانتینری، Compose و restore واقعی آزموده نشده‌اند؛ بنابراین کد هنوز deploy-ready نیست.

## جدول‌های routeهای Next و schema مشاهده‌شده

در خلاصه‌ی ستون‌ها، `NOT NULL` و `DEFAULT` همان خروجی catalog هستند؛ ستون nullable با `NULL` آمده است و اگر default ذکر نشده، در خروجی default نداشته است.

| جدول | ستون‌ها |
|---|---|
| `cart_items` | `id uuid NOT NULL DEFAULT gen_random_uuid()`؛ `user_id uuid NOT NULL`؛ `course_id uuid NOT NULL`؛ `created_at timestamptz NULL DEFAULT now()` |
| `course_sessions` | `id uuid NOT NULL DEFAULT gen_random_uuid()`؛ `course_id uuid NOT NULL`؛ `session_number integer NOT NULL`؛ `title text NOT NULL`؛ `description text NULL`؛ `content_type text NOT NULL DEFAULT 'video'`؛ `provider text NOT NULL DEFAULT 'aparat'`؛ `video_url text NULL`؛ `file_url text NULL`؛ `duration integer NULL`؛ `is_free boolean NULL DEFAULT false`؛ `created_at timestamptz NULL DEFAULT now()`؛ `is_online boolean NOT NULL DEFAULT false`؛ `online_url text NULL`؛ `scheduled_at timestamptz NULL` |
| `courses` | `id uuid NOT NULL DEFAULT gen_random_uuid()`؛ `title text NULL`؛ `grade bigint NULL`؛ `category text NULL`؛ `type text NULL`؛ `description text NULL`؛ `price bigint NULL`؛ `discount_price bigint NULL`؛ `image_url text NULL`؛ `major text NULL`؛ `requires_shipping boolean NOT NULL DEFAULT false` |
| `orders` | `id uuid NOT NULL DEFAULT gen_random_uuid()`؛ `user_id text NOT NULL`؛ `authority text NULL`؛ `amount_rial bigint NOT NULL`؛ `description text NULL`؛ `status text NOT NULL DEFAULT 'init'`؛ `source text NOT NULL DEFAULT 'cart'`؛ `items jsonb NOT NULL DEFAULT '[]'::jsonb`؛ `ref_id bigint NULL`؛ `card_pan text NULL`؛ `created_at timestamptz NOT NULL DEFAULT now()`؛ `verified_at timestamptz NULL`؛ `course_ids text[] NOT NULL DEFAULT '{}'::text[]` |
| `otp_codes` | `id uuid NOT NULL DEFAULT gen_random_uuid()`؛ `phone varchar(15) NOT NULL`؛ `code_hash varchar(255) NOT NULL`؛ `purpose varchar(30) NOT NULL`؛ `expires_at timestamp without time zone NOT NULL`؛ `attempts integer NULL DEFAULT 0`؛ `created_at timestamp without time zone NULL DEFAULT now()` |
| `shipments` | `id uuid NOT NULL DEFAULT gen_random_uuid()`؛ `order_id uuid NOT NULL`؛ `user_id text NOT NULL`؛ `full_name text NOT NULL`؛ `phone text NOT NULL`؛ `province text NOT NULL`؛ `city text NOT NULL`؛ `address text NOT NULL`؛ `postal_code text NOT NULL`؛ `created_at timestamptz NOT NULL DEFAULT now()`؛ `updated_at timestamptz NOT NULL DEFAULT now()`؛ `status text NOT NULL DEFAULT 'pending'`؛ `tracking_code text NULL`؛ `sent_at timestamptz NULL` |
| `site_content` | `key text NOT NULL`؛ `value text NOT NULL DEFAULT ''`؛ `updated_at timestamptz NOT NULL DEFAULT now()`؛ `updated_by uuid NULL` |
| `site_users` | `id uuid NOT NULL DEFAULT gen_random_uuid()`؛ `phone varchar(15) NOT NULL`؛ `password_hash varchar(255) NOT NULL`؛ `role varchar(20) NULL DEFAULT 'student'`؛ `is_active boolean NULL DEFAULT true`؛ `created_at timestamp without time zone NULL DEFAULT now()`؛ `updated_at timestamp without time zone NULL DEFAULT now()`؛ `last_login timestamp without time zone NULL`؛ `first_name varchar(50) NOT NULL DEFAULT ''`؛ `last_name varchar(50) NOT NULL DEFAULT ''`؛ `grade text NULL`؛ `major text NULL` |
| `user_addresses` | `user_id text NOT NULL`؛ `full_name text NOT NULL`؛ `phone text NOT NULL`؛ `province text NOT NULL`؛ `city text NOT NULL`؛ `address text NOT NULL`؛ `postal_code text NOT NULL`؛ `updated_at timestamptz NOT NULL DEFAULT now()` |
| `user_purchases` | `id uuid NOT NULL DEFAULT gen_random_uuid()`؛ `user_id uuid NOT NULL`؛ `course_id uuid NOT NULL`؛ `purchased_at timestamptz NOT NULL DEFAULT now()`؛ `payment_status text NOT NULL DEFAULT 'paid'`؛ `amount numeric(10,2) NULL`؛ `created_at timestamptz NOT NULL DEFAULT now()` |
| `user_sessions` | `id uuid NOT NULL DEFAULT gen_random_uuid()`؛ `user_id uuid NOT NULL`؛ `token_hash varchar(255) NOT NULL`؛ `user_agent text NULL`؛ `ip_address varchar(45) NULL`؛ `expires_at timestamp without time zone NOT NULL`؛ `created_at timestamp without time zone NULL DEFAULT now()`؛ `is_active boolean NULL DEFAULT true` |

### Constraintها و indexهای مهم

- همه‌ی جدول‌ها primary key دارند: معمولاً `id`؛ `site_content.key` و `user_addresses.user_id` استثنا هستند.
- Foreign keyها: `cart_items.user_id → site_users.id`، `cart_items.course_id → courses.id`، `course_sessions.course_id → courses.id`، `shipments.order_id → orders.id`، `user_purchases.user_id → site_users.id`، `user_purchases.course_id → courses.id` و `user_sessions.user_id → site_users.id`؛ همه‌ی FKهای گزارش‌شده `ON DELETE CASCADE` و validated هستند.
- Unique: `(cart_items.user_id, course_id)`، `orders.authority`، `shipments.order_id`، `site_users.phone`، `(user_purchases.user_id, course_id)` و `user_sessions.token_hash`.
- Check: `otp_codes.purpose` فقط `register`، `reset_password` یا `change_phone` است؛ `site_users.role` فقط `student`، `teacher` یا `admin` است.
- Indexهای غیربنیادی گزارش‌شده (هر مورد index جداگانه است، نه index مرکب): `orders.created_at DESC`، `orders.status`، `orders.user_id`؛ `otp_codes.phone` و `otp_codes.purpose`؛ `shipments.created_at DESC`، `shipments.order_id`، `shipments.status`؛ `site_content.updated_at DESC`؛ و `user_sessions.user_id`.
- به‌نظر می‌رسد چند index تکراری/اضافی باشند: `shipments_order_idx` کنار unique index روی `shipments.order_id`؛ `idx_sessions_token` کنار unique index روی `user_sessions.token_hash`؛ `idx_users_phone` کنار unique index روی `site_users.phone`؛ و unique index جداگانه‌ی `user_addresses_user_id_key` کنار primary key همان ستون. هنگام انتقال فعلاً این‌ها را حذف یا تغییر ندهیم؛ ابتدا رفتار و کارایی را حفظ کنیم.
- نام index کلید اصلی `courses` در خروجی `coursed_pkey` است. نام غیرمعمول است، ولی constraint گزارش‌شده همچنان `PRIMARY KEY (id)` است.
- در خروجی `site_users` شماره‌ی ordinal ستون از ۳ به ۵ می‌پرد؛ query ستون‌های حذف‌شده را کنار می‌گذارد، پس ممکن است ordinal 4 یک ستون حذف‌شده‌ی قدیمی باشد. نام و نوع آن از این خروجی قابل بازیابی نیست.

## مجوزها و رفتار RLS مشاهده‌شده

- هر ۱۱ جدول `RLS enabled = true` و `RLS forced = false` دارند.
- تنها policy گزارش‌شده `courses`: دستور `SELECT` برای `PUBLIC` با `USING (true)` است. برای جدول‌های دیگر policyای در خروجی نیامده است.
- خروجی grantها به `anon` و `authenticated` روی بیشتر جدول‌ها privilegeهای وسیع نشان می‌دهد، اما RLS همچنان دسترسی ردیفی را محدود می‌کند؛ بدون policy مناسب، این roleها از API به ردیف‌های آن جدول دسترسی نمی‌گیرند. `courses` استثناست و خواندن عمومی دارد.
- `service_role` روی جدول‌ها grant دارد و در Supabase از RLS عبور می‌کند. کد Next هر دو client عمومی و service-role را می‌سازد؛ مسیرهای privileged باید بعد از مهاجرت همچنان با بررسی نشست، مالکیت و نقش در لایه‌ی server محافظت شوند. `site_content` در خروجی فقط grantهای `postgres` و `service_role` داشت.
- grantها/نام roleهای Supabase را نباید کورکورانه به PostgreSQL مستقل منتقل کرد؛ طراحی role و مجوز مقصد باید بر اساس دسترسی واقعی routeها انجام شود.

## Functionها، extensionها و triggerها

**نسخه‌ی مبدأ:** PostgreSQL 17.6؛ مقصد اولیه را PostgreSQL 17.x می‌گیریم.

Functionهای برگشتی از SQL Editor:

- `public.update_updated_at_column()` بدنه‌اش تأیید شد: `NEW.updated_at = NOW(); RETURN NEW;`. با trigger گزارش‌شده‌ی `update_site_users_updated_at` سازگار است و در migration اولیه ثبت شده.
- `public.get_auth_user_id_by_token()` به `current_setting('request.headers', true)` وابسته است (تنظیم Supabase/PostgREST) و از `user_sessions.token` می‌خواند؛ ولی schema فعال فقط `token_hash` دارد. در مخزن هم ارجاعی پیدا نشد و query وابستگی trigger/policy هم هیچ مصرفی نشان نداد؛ آن را legacy می‌دانیم و به PostgreSQL مستقل منتقل نمی‌کنیم.
- `public.handle_new_user_profile()` به `public.profiles` می‌نویسد، ولی `profiles` در ۱۱ جدول گزارش‌شده نیست. در مخزن و query وابستگی trigger/policy هم مصرفی پیدا نشد؛ آن را هم در migration دیتابیس سایت وارد نمی‌کنیم. کد قدیمی را از پروژه‌ی زنده‌ی Supabase حذف نمی‌کنیم؛ فقط آن را در مقصد جدید بازسازی نمی‌کنیم.

Extensionهای گزارش‌شده:

| Extension | نسخه/Schema | تصمیم اولیه برای VPS |
|---|---|---|
| `pg_stat_statements` | `1.11`، `extensions` | برای آمار query اختیاری است؛ برای اجرای برنامه لازم نیست. |
| `pgcrypto` | `1.3`، `extensions` | در DDL مشاهده‌شده فقط `gen_random_uuid()` لازم است؛ PostgreSQL 17 آن را دارد. اگر full dump تابع دیگری از این extension بخواهد، دوباره ارزیابی می‌کنیم. |
| `plpgsql` | `1.0`، `pg_catalog` | زبان روی PostgreSQL استاندارد موجود است. |
| `supabase_vault` | `0.3.1`، `vault` | مخصوص Supabase؛ در کد پروژه ارجاعی نیافتیم، پس به سرور مستقل منتقل نمی‌کنیم مگر trigger/policy/dependency فعالی پیدا شود. |
| `uuid-ossp` | `1.1`، `extensions` | در کد و DDL فعلی استفاده نشده؛ فعلاً لازم نیست. |

query وابستگی در همه‌ی schemaها اجرا شد. خروجی فقط این دو مورد بود: trigger سایت روی `public.site_users` و trigger داخلی Supabase روی `storage.objects`. `get_auth_user_id_by_token` و `handle_new_user_profile` به trigger/policy فعالی وصل نبودند. trigger `storage.objects` از `storage.update_updated_at_column()` استفاده می‌کند؛ این trigger و جدول‌های schema داخلی Storage را با Supabase Storage جایگزین می‌کنیم و به PostgreSQL برنامه منتقل نمی‌کنیم.

تعریف trigger عمومی سایت در migration اولیه آمده است. trigger مربوط به `storage.objects` متعلق به Supabase Storage است و با حذف آن سرویس کنار گذاشته می‌شود؛ داده و تنظیمات فعلی Storage باید جداگانه export شوند.

فعلاً **هیچ migrationی اجرا نشده و هیچ اتصال واقعی به PostgreSQL انجام نشده است**. همه‌ی routeهای فعالِ Next در کد از PostgreSQL یا Storage محلی استفاده می‌کنند؛ تست‌ها از pool ساختگی‌اند و استقلال runtime را از نظر کد نشان می‌دهند، نه صحت DDL/مجوز/اتصال واقعی. نسخه‌ی فعلی برای deploy آماده نیست.

## نکته‌های تطبیق با کد و طراحی مقصد

1. `site_users.id` از نوع `uuid` است، اما `orders.user_id`، `shipments.user_id` و `user_addresses.user_id` از نوع `text` هستند و FK گزارش‌شده ندارند. در مقابل `cart_items`، `user_purchases` و `user_sessions` به `site_users.id` با UUID وصل‌اند. نباید بدون بررسی داده و routeها این ستون‌ها را یکسان‌سازی یا FK جدید اضافه کرد.
2. `orders.course_ids` از نوع `text[]` و `orders.items` از نوع `jsonb` است؛ `user_purchases.course_id` جداگانه UUID است. قراردادهای legacy و نحوه‌ی ساخت/خواندن سفارش باید حفظ شوند.
3. `otp_codes`، `user_sessions` و timestampهای `site_users` از نوع `timestamp without time zone` هستند؛ بقیه‌ی زمان‌های عملیاتی عمدتاً `timestamptz` هستند. رفتار UTC و مقایسه‌ی expiry در routeها باید صریحاً بررسی شود.
4. برای `course_sessions` در خروجی unique constraint روی `(course_id, session_number)` دیده نشد؛ آن را بدون تأیید اضافه نکنیم.
5. در خروجی relation، enum، sequence یا viewی برنگشت؛ این مشاهده از query ارسالی است، نه جایگزین full dump.

## ذخیره‌سازی و VPS

مالک گزارش کرده bucketهای فعلی `course-files` و `course-images` خالی‌اند و برای مجموع فایل‌ها حداکثر ۱ GB در نظر دارد. این برای طراحی volume محلی اولیه کافی است؛ فایل‌ها و volume backup باید در cutover جداگانه بررسی شوند.

- حداقل پیشنهادی: VPS با ۲ vCPU، ۴ GB RAM و ۸۰ GB NVMe.
- پیشنهادی برای production: ۴ vCPU، ۸ GB RAM و ۱۰۰ GB NVMe؛ x86_64/AMD64، Ubuntu 24.04 LTS، root/sudo و Docker/Compose.
- دامنه‌های فعلی ثابت می‌مانند. PostgreSQL فقط روی شبکه‌ی خصوصی/داخلی VPS اجرا می‌شود؛ پورت 5432 عمومی نمی‌شود.
- Backup رمزگذاری‌شده باید خارج از همان VPS نگهداری و restore آن آزمایش شود.

مهاجرت اولیه هنوز scaffold است: بدنه‌ی trigger عمومی با source تطبیق داده شد و هشت route (دو route دوره و شش route حساب/نشست) در کد به PostgreSQL منتقل شده‌اند. تست‌ها با pool ساختگی برای کل مجموعه موفق‌اند و build تولیدی هم انجام شده، اما DDL با PostgreSQL واقعی اجرا نشده و routeها با دیتابیس واقعی آزمایش نشده‌اند. بقیه‌ی routeها همچنان Supabase را صدا می‌زنند؛ داده/فایل live export یا restore نشده است. این نسخه‌ی میان‌مرحله‌ای را deploy نکنید. Supabase تا backup، restore آزمایشی و rollback موفق روشن می‌ماند.
