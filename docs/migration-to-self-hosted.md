# برنامه‌ی خروج از Vercel و Supabase به هاست مستقل

## تصمیم پیشنهادی

- **صفحه‌ها لازم نیست به Next.js بازنویسی شوند.** بخش وب فعلی ۱۴ صفحه‌ی HTML و فایل‌های CSS/JS است؛ Nginx آن‌ها را روی VPS سرو می‌کند و Next.js فقط API/runtime را پشت Nginx اجرا می‌کند. مقصد خواسته‌شده یک VPS با PostgreSQL و Storage محلی است.
- **وضعیت فعلی کد:** همه‌ی APIهای فعال Next از PostgreSQL مستقل و Storage محلی استفاده می‌کنند؛ ۳۱ handler function و دو GET در routeهای اختصاصی هستند و پراکسی Edge allowlist خالی دارد. Supabase دیگر dependency/runtime secret نسخه‌ی self-hosted نیست، اما نسخه‌ی زنده‌ی قدیمی تا پایان backup/rollback window روشن می‌ماند. این کد هنوز با PostgreSQL/Docker واقعی و staging آزموده نشده است. پیامک و زرین‌پال سرویس‌های بیرونی مستقلی هستند.
- **کدنویسی migration اکنون انجام شده، اما cutover یک‌مرحله‌ایِ بدون staging توصیه نمی‌شود.** schema مقصد از inventory ساختاری بازسازی شده و با PostgreSQL واقعی validate نشده است؛ target عمداً از دیتابیس خالی شروع می‌کند و داده‌ی کاربران/سفارش‌های قدیمی منتقل نمی‌شود.
- گام بعدی اجرای دقیق همین Compose روی staging، آزمون واقعی DB/Storage/پرداخت/backup و سپس cutover دامنه‌ی فعلی است. Vercel و Supabase قبلی تا پایان backup/rollback window و پایش روشن بمانند.

### انتخاب مقصد

| مقصد | میزان بازنویسی | نتیجه |
|---|---:|---|
| Reverse proxy + Supabase فعلی | کم | سریع‌ترین و کم‌ریسک‌ترین راه خروج از Vercel؛ هنوز وابسته به Supabase می‌مانید. |
| Nginx/Next.js + **Supabase خودمیزبان** | متوسط | سازگاری بیشتری با SDK و API فعلی دارد، اما نگه‌داری چند سرویس Supabase روی VPS پیچیده و پرمصرف است. |
| **Next.js + PostgreSQL معمولی + ذخیره‌سازی فایل مستقل (مقصد انتخاب‌شده)** | زیاد | استقلال از Supabase؛ routeها, database access, local Storage و backup code منتقل شده‌اند. Deploy/staging واقعی هنوز لازم است. |

اگر هدف «یک VPS و حداقل هزینه‌ی ماهانه» است، گزینه‌ی سوم شدنی است، ولی دیتابیس، برنامه و فایل‌ها روی یک ماشین نقطه‌ی خرابی واحد می‌شوند. در هر گزینه، backup خارج از همان VPS و آزمون restore ضروری است. برآورد هزینه‌ی واقعی هم به RAM/CPU، حجم PDFها، ترافیک و نوع backup بستگی دارد.

### پیشنهاد اولیه برای خرید VPS

این مشخصات نقطه‌ی شروع است، نه تضمین ظرفیت؛ کاربر گزارش کرده دو bucket فعلی خالی‌اند و حداکثر ۱ GB فضا می‌خواهد. برای رشد فایل‌ها و ترافیک headroom نگه می‌داریم و پیش از cutover دوباره وضعیت را می‌سنجیم.

| مورد | پیشنهاد شروع |
|---|---|
| نوع | VPS با دسترسی root/sudo و پشتیبانی رسمی Docker Engine + Compose؛ هاست اشتراکی مناسب نیست. |
| CPU و RAM | ۴ vCPU و ۸ GB RAM برای Next.js، PostgreSQL و آپلود فایل روی یک میزبان. |
| دیسک | حداقل ۸۰ GB NVMe؛ ۱۰۰ GB پیشنهادی برای production و headroom. فایل‌های Storage فعلی خالی‌اند و سقف برنامه‌ریزی‌شده ۱ GB است. Backup را تنها روی همان دیسک نگذارید. |
| معماری و OS | x86_64/AMD64، Ubuntu 24.04 LTS. |
| شبکه | دیتاسنتر نزدیک کاربران (اگر بیشتر کاربران اروپا هستند، آلمان/Frankfurt گزینه‌ی منطقی است)، IPv4 عمومی و ترافیک ماهانه‌ی متناسب با دانلود فایل‌های دوره. |
| امنیت | بیرون فقط SSH محدودشده و 80/443؛ PostgreSQL روی شبکه‌ی داخلی Docker/localhost، نه پورت عمومی 5432. Backup رمزگذاری‌شده و خارج از VPS، همراه آزمون restore. |

با توجه به گزارش فعلیِ خالی بودن دو bucket و سقف ۱ GB، حداقل ۲ vCPU، ۴ GB و ۸۰ GB NVMe برای شروع کم‌ترافیک قابل‌قبول است؛ برای production پیشنهاد من ۴/۸/۱۰۰ است. پیش از انتقال نهایی، حجم و تعداد فایل‌ها را دوباره از Supabase بررسی می‌کنیم.

## ممیزی مخزن

| بخش | وضعیت فعلی |
|---|---|
| وب | ۱۴ صفحه‌ی HTML و فایل‌های CSS/JS؛ build یا runtime مخصوص Vercel ندارد. |
| Vercel | `vercel.json` مسیرهای بدون `.html` را فعال می‌کند و ریشه‌ی زیردامنه‌ی مدیر را به `/admin-login` می‌برد. |
| API | ۳۶ پوشه در `supabase/functions`; بخشی از کد با `Deno.serve` و `Deno.env` اجرا می‌شود. |
| اتصال مرورگر به API | همه‌ی APIهای فعال browser-facing route اختصاصی Next دارند؛ ۳۱ handler function و دو GET از PostgreSQL و Storage محلی استفاده می‌کنند. allowlist پراکسی Edge خالی و fail-closed است؛ هیچ API را به Edge نمی‌فرستد. نسخه‌های Edge فقط legacy/rollback در مخزن‌اند. |
| داده | جدول‌هایی مثل `site_users`، `user_sessions`، `otp_codes`، `courses`، `orders`، `cart_items`، `user_purchases` و `course_sessions` استفاده می‌شوند. |
| Storage مبدأ / مقصد | تولید قبلی از bucket خصوصی `course-files` و عمومی `course-images` استفاده می‌کرد؛ مقصد self-hosted در volume محلی فایل نگه می‌دارد و PDF با لینک امضاشده‌ی موقت تحویل می‌دهد. هر دو bucket فعلی خالی‌اند و import فایل ندارند. |
| ورود | منطق سفارشی شماره/رمز؛ hash رمز از نوع PBKDF2-SHA256 با قالب `salt:hash` است. نشست‌ها با hash توکن ذخیره می‌شوند و توکن مرورگر فعلاً در `localStorage` است. |
| بیرونی‌ها | زرین‌پال، sms.ir/کاوه‌نگار، و چند CDN برای کتابخانه/فونت. انتقال هاست، این سرویس‌ها را خودبه‌خود حذف نمی‌کند. |

**محدودیت حیاتی:** migration مقصد از catalog ساختاری ۱۱ جدول بازسازی شده و هنوز روی PostgreSQL واقعی اجرا/بازبینی نشده است. کاربر تأیید کرده انتقال داده‌ی قدیمی لازم نیست و DB تازه/خالی پذیرفته است؛ بنابراین کاربران، نشست‌ها، دوره‌ها، خریدها و فایل‌های قبلی به مقصد import نمی‌شوند. از Supabase قدیمی و Vercel برای rollback نگه‌داری کنید، از داده‌ی مبدأ backup بگیرید، و پیش از production migration مقصد را از صفر اجرا و smoke-test کنید.

## مراحل اجرایی و وضعیت فعلی

| مرحله | خروجی | وضعیت |
|---|---|---|
| ۰ — شناخت و backup | مقصد مشخص، export کامل، restore آزمایشی و baseline تست | بررسی کد انجام شده؛ backup/export زنده هنوز انجام نشده است. |
| ۱ — وب ایستا | میزبانی مستقل همان HTML/CSS/JS با حفظ مسیرها | Nginx/Docker و launcher یک‌فرمانی در مخزن آماده‌اند؛ web روی loopback است و reverse proxy/TLS عمومی بسته‌بندی نشده؛ هنوز روی VPS اجرا نشده و DNS تغییر نکرده است. |
| ۲ — زیرساخت Next.js | اجرای Node/Next در کنار نسخه‌ی فعلی، health/logging و مسیر API؛ HTTPS عمومی جداگانه توسط proxy بیرونی تأمین می‌شود. | اسکلت Next.js، مسیر `/api/health` و proxy مسیر `/api/*` اضافه شده‌اند؛ `npm test` و `npm run build` موفق‌اند. Docker/staging هنوز اجرا نشده است. |
| ۳ — APIها | انتقال endpointها به Next و سپس backend مستقل | همه‌ی APIهای فعال browser-facing در routeهای اختصاصی Next هستند؛ ۳۱ handler با PostgreSQL و ۲ GET نیز با PostgreSQL کار می‌کنند. allowlist Edge خالی است؛ SDK Supabase از Next حذف شده. تست mock/build وجود دارد، اما PostgreSQL واقعی، Zarinpal staging و browser e2e آزموده نشده‌اند. |
| ۴ — رابط کاربری Next.js | انتقال اختیاری/تدریجی صفحه‌ها با حفظ URL و SEO | شروع نشده است؛ برای خروج از Vercel اجباری نیست. |
| ۵ — PostgreSQL | schema مستقل و اتصال routeها | baseline ساختاری ۱۱ جدول، `pg` pool، transaction helper و migration runner اضافه‌اند. همه‌ی ۳۱ route/handler داده‌ای به query مستقیم PostgreSQL منتقل شده‌اند؛ migration و queryها هنوز با PostgreSQL واقعی/Docker اجرا نشده‌اند. انتقال داده‌ی قدیمی لازم نیست؛ مقصد از صفر شروع می‌کند. دو function قدیمیِ بدون مصرف به مقصد منتقل نمی‌شوند. |
| ۶ — فایل‌ها | Storage مستقل با حفظ فایل خصوصی/عمومی و لینک موقت | پیاده‌سازی محلی/HMAC، مسیر upload/download، public image alias در Nginx، quota 1 GiB و backup/restore script اضافه شده‌اند. bucketهای قدیمی خالی‌اند؛ Docker volume/Nginx و restore واقعی هنوز آزموده نشده‌اند. |
| ۷ — staging و cutover | آزمون end-to-end روی DB خالی، توقف پرداخت‌های درحال‌پرداخت قدیمی، سپس DNS | شروع نشده است؛ به ثبت‌نام مجدد کاربران و نبود migration داده‌ی قدیمی نیاز دارد. |
| ۸ — پایش و جمع‌کردن سرویس‌های قدیمی | پایش، حفظ rollback، سپس لغو Vercel/Supabase | شروع نشده است. |

> **تعبیر «مرحله‌ی ۱ انجام شد»:** فایل‌های لازم برای deploy مرحله‌ی ۱ نوشته شده‌اند. اجرای آن روی هاست واقعی، TLS، smoke test و تغییر DNS هنوز انجام نشده است.

### مرحله‌ی ۰ — تعیین مقصد و گرفتن backup

قبل از دست‌زدن به داده‌ی زنده:

1. مقصد را مشخص کنید: سیستم‌عامل VPS، RAM/CPU، فضای دیسک، حجم تقریبی PDFها/عکس‌ها، دامنه‌ها و روش TLS/reverse proxy.
2. از Supabase یک backup کامل PostgreSQL بگیرید؛ schema، extensionها، indexها، sequenceها، triggerها و policyهای RLS را هم نگه دارید. **فایل را روی محیط آزمایشی restore کنید**؛ backupای که restore نشده هنوز تأییدشده نیست.
3. مالک گزارش کرده `course-files` و `course-images` خالی‌اند؛ در زمان pre-cutover دوباره فهرست/حجم را از پروژه‌ی قدیمی بررسی کنید. اگر خالی بودند چیزی به مقصد import نکنید؛ اگر فایل تازه‌ای پیدا شد، cutover را متوقف و درباره‌ی نگه‌داری‌اش تصمیم بگیرید.
4. فقط نام secretها و محل تنظیمشان را فهرست کنید: DB، Storage signing key، تنظیمات زرین‌پال و پیامک. مقدار secret را در Git یا چت قرار ندهید؛ آن‌ها را فقط در environment سرور قرار دهید. کلیدهای Supabase در runtime مقصد لازم نیستند.
5. برای rollback تعداد/وضعیت کاربران، سفارش‌های پرداخت‌شده/در انتظار و فایل‌های قدیمی را ثبت کنید. این داده‌ها به DB مقصد import نمی‌شوند مگر کاربر بعداً این تصمیم را تغییر دهد.
6. تست فعلی را به‌عنوان baseline نگه دارید: `cd tests && npm ci && npm test`.

**شرط عبور:** backup رمزگذاری‌شده‌ی Supabase قدیمی و فایل‌ها برای rollback محفوظ باشد و restore آن در محیط آزمایشی موفق شود. این backup به target وارد نمی‌شود. عملیات زنده به دسترسی مالک Supabase نیاز دارد و از داخل این مخزن انجام نشده است.

### مرحله‌ی ۱ — انتقال میزبانی فایل‌های وب

پیکربندی موجود در [`deploy/self-hosted/`](../deploy/self-hosted/README.md) image ایستای Nginx را می‌سازد؛ Compose سرویس وب را فقط روی `127.0.0.1:8080` منتشر می‌کند و `start.sh` کل stack را با یک فرمان build/start می‌کند. reverse proxy عمومی و TLS در این مخزن بسته‌بندی نشده‌اند و برای اجرای stack لازم نیستند؛ برای public access باید proxy موجود روی VPS/provider را جداگانه تنظیم کنید. URLهای تمیز مثل `/courses`، فایل‌های صریحی که صفحه‌ها درخواست می‌کنند مثل `/components/header.html` و ریشه‌ی `admin.mahdiazizi.com` را پوشش می‌دهد. Compose علاوه بر وب، سرویس Next.js، APIهای منتقل‌شده، PostgreSQL و Storage را هم بالا می‌آورد. این launcher هنوز در VPS واقعی اجرا/تأیید نشده است.

1. روی VPS آزمایشی Docker Compose را اجرا کنید؛ دستورها در `deploy/self-hosted/README.md` هستند.
2. از روی خود VPS مسیرهای `/`، `/courses`، `/components/header.html` و `/admin-login` را smoke test کنید؛ ریشه‌ی زیردامنه‌ی مدیر باید `302` به `/admin-login` بدهد.
3. reverse proxy/TLS را روی staging تنظیم کنید و staging را با IP allowlist یا Basic Auth محدود کنید؛ آن را indexپذیر نکنید، چون canonicalهای صفحه‌ها به دامنه‌ی اصلی اشاره دارند.
4. در مرورگر layout، CSS، تصویرها، query string صفحه‌ی جزئیات، هدر/فوتر و دامنه‌ی مدیر را بررسی کنید.
5. Vercel و Supabase قدیمی را برای rollback خاموش نکنید. نسخه‌ی self-hosted در کد دیگر به آن‌ها query نمی‌زند، اما هنوز DB واقعی/Compose/Storage/backup restore آزمایش نشده است؛ بنابراین DNS اصلی را تغییر ندهید. اگر پس از cutover rollback لازم شد، داده‌های تازه‌ی PostgreSQL باید جداگانه reconcile/restore شوند؛ روشن‌ماندن Supabase به‌تنهایی آن‌ها را mirror نمی‌کند.

**شرط عبور:** پاسخ صفحه‌ها و assetها درست باشد و سایت در staging بدون تغییر داده‌ی زنده کار کند. این smoke فقط وب ایستا/Nginx را بررسی می‌کند؛ تأیید استقلال API/DB/Storage نیازمند آزمون مرحله‌ی ۷ روی stack کامل است.

### مرحله‌ی ۲ — راه‌اندازی Next.js به‌عنوان سرویس مستقل

**بخش کدنویسی این مرحله انجام شده است:** اپ اولیه در `apps/next-app/` قرار دارد و Node.js 22/Next.js را با build مستقل آماده می‌کند. Nginx درخواست‌های `/api/*` را به سرویس داخلی `next-app:3000` می‌فرستد؛ پورت Next.js مستقیماً روی اینترنت publish نمی‌شود. مسیر `GET /api/health` فقط زنده‌بودن process را می‌سنجد، نه اتصال به دیتابیس؛ endpointهای داده‌ای که بعداً در مرحله‌ی ۳ اضافه شدند در همان بخش توضیح داده شده‌اند.

آزمون محلی اجراشده:

```bash
cd apps/next-app
npm ci
npm test
npm run build
```

هم تست health و هم build تولیدی موفق شده‌اند. **Docker Compose و deploy روی staging هنوز اجرا نشده‌اند**، چون Docker در محیط این کار موجود نبود.

ادامه‌ی این مرحله روی staging:

1. `./deploy/self-hosted/create-env.sh` فایل `.env` خصوصی را می‌سازد؛ runtime به Supabase URL/key نیاز ندارد. `payment-request` و `payment-verify` از PostgreSQL و زرین‌پال استفاده می‌کنند؛ مقدارهای `ZARINPAL_MERCHANT_ID`، `ZARINPAL_SANDBOX`، `ZARINPAL_CALLBACK_URL` و `PRICE_TO_RIAL_FACTOR` را تنظیم کنید. برای OTP کلید sms.ir یا کاوه‌نگار لازم است؛ `OTP_DEBUG=false` بماند و در production بدون provider route کد آزمایشی برنمی‌گرداند.
2. با `docker compose --env-file .env -f deploy/self-hosted/compose.yaml config --quiet` پیکربندی را بدون چاپ مقدار secret بررسی کنید؛ سپس `build` و `up -d` را طبق راهنمای deploy اجرا کنید.
3. صفحه‌های ایستا، `/api/health` و مسیرهای عمومی مرحله‌ی ۳ را از پشت Nginx آزمایش کنید.
4. health check، log، restart خودکار و HTTPS/reverse proxy را روی هاست بررسی کنید؛ فقط DB/app، signing key، SMS و payment secrets به runtime لازم‌اند و نباید وارد JavaScript مرورگر یا image عمومی شوند.
5. APIها به PostgreSQL و Storage محلی وصل‌اند؛ dataset مقصد خالی است و دوره/محتوا را باید با bootstrap و پنل بسازید. تکمیل کد به‌تنهایی مجوز تغییر DNS اصلی نیست؛ staging باید واقعی و مستقل آزمایش شود.

**شرط عبور:** سرویس Next.js در staging با HTTPS پایدار باشد، `/api/health` از مسیر Nginx پاسخ دهد و secretی در bundle مرورگر نباشد. هنوز نیازی به تغییر schema یا DNS اصلی نیست.

### مرحله‌ی ۳ — انتقال APIها و منطق Edge Function

APIها مرحله‌به‌مرحله منتقل شده‌اند و runtime Next اکنون Supabase SDK/secret ندارد. تغییرات بعدی باید روی PostgreSQL واقعی staging و بدون خاموش‌کردن نسخه‌ی قدیمی تا پایان rollback window بررسی شوند.

**زیربخش اول (پیاده‌سازی‌شده در مخزن):**

- `GET /api/courses` فهرست دوره‌ها را از PostgreSQL می‌خواند و قرارداد `{ data, error }` را برای صفحه‌ها حفظ می‌کند؛ `home.js` و `courses.js` دیگر مستقیماً Supabase JS را صدا نمی‌زنند.
- `POST /api/functions/get-course` جزئیات عمومی یک دوره را با همان پاسخ `{ success, course }` می‌دهد؛ `apiCall("get-course")` به این مسیر می‌رود.
- `GET /api/site-content` محتوای عمومی را از PostgreSQL برمی‌گرداند؛ `POST /api/functions/site-content` عملیات ذخیره/بازگردانی مدیر را با نشست PostgreSQL، نقش admin و محدودیت اندازه/تعداد کلیدها انجام می‌دهد.
- `.env.example` فقط نام متغیرها/placeholder دارد. runtime مقصد Supabase keys نمی‌خواهد؛ secrets واقعی DB، Storage، SMS و پرداخت فقط در environment سرور بمانند.

**زیربخش دوم (حساب و امنیت، پیاده‌سازی‌شده در مخزن):**

- شش route حساب/نشست (`login-user`، `register-user`، `check-session`، `logout-user`، `update-profile` و `change-password`) اکنون در کد به PostgreSQL با queryهای پارامتری متصل‌اند؛ تست‌هایشان با pool ساختگی PostgreSQL اجرا می‌شود.
- `POST /api/functions/check-session` نشست را با SHA-256 هش‌شده‌ی توکن در `user_sessions` PostgreSQL پیدا می‌کند، انقضا را بررسی/نشست منقضی را غیرفعال می‌کند و پاسخ موفق `{ success: true, user }` با فیلدهای امن قبلی را حفظ می‌کند.
- `POST /api/functions/logout-user` نشست فعال PostgreSQL را غیرفعال می‌کند و قرارداد موفق `{ success, message }` را حفظ می‌کند.
- `POST /api/functions/login-user` کاربر را در PostgreSQL می‌یابد، hashهای فعلی PBKDF2-SHA256 را verify می‌کند، نشست ۳۰روزه را با SHA-256 توکن ذخیره می‌کند و همان فیلدهای کاربر را برمی‌گرداند.
- `POST /api/functions/register-user` کاربر را در PostgreSQL می‌سازد. `send-otp` و `otp-verify` نیز OTP را hash‌شده در PostgreSQL نگه می‌دارند؛ cooldown، expiry، تلاش محدود و مصرف یک‌باره پیاده شده‌اند. ترتیب کلاینت حفظ شده: ابتدا `otp-verify` و بعد `register-user`. در production بدون SMS provider کد افشا نمی‌شود.
- `POST /api/functions/update-profile` و `POST /api/functions/change-password` نشست فعال و کاربر را در PostgreSQL بررسی می‌کنند؛ رفتار پایه‌ی نهم، پیام خطای schema، حداقل ۸ کاراکتر برای رمز جدید و غیرفعال‌سازی نشست‌های دیگر حفظ شده است.
- helperهای `apps/next-app/lib/password-hash.js` و `apps/next-app/lib/phone.js` قالب `saltHex:hashHex` با PBKDF2-SHA256/۱۰۰٬۰۰۰ iteration و نرمال‌سازی شماره‌ی فعلی را نگه می‌دارند. تمام routeهای فعال Next اکنون PostgreSQL یا Storage محلی را هدف می‌گیرند؛ انتقال داده‌ی کاربران قدیمی به‌دلیل تصمیم کاربر لازم نیست.
- `apiCall` هر شش endpoint حساب/نشست را به routeهای اختصاصی same-origin می‌فرستد. توکن مرورگر عمداً همچنان در `localStorage` و body همان `{ token }` است؛ انتقال به cookie امن بازطراحی جداگانه‌ای است.
- تست‌های auth/session و auth/account با pool ساختگی PostgreSQL اجرا می‌شوند؛ این‌ها اتصال واقعی یا staging محسوب نمی‌شوند. دیتابیس مقصد از صفر ساخته می‌شود، پس کاربران/نشست‌های قدیمی منتقل نمی‌شوند.

**زیربخش سوم (سبد، نشانی و دسترسی خرید، پیاده‌سازی‌شده در مخزن):**

- routeهای `add-to-cart`، `get-cart` و `remove-from-cart` در Next نشست فعال را بررسی می‌کنند؛ حذف سبد با `user_id` محدود می‌شود و دوره‌ی خریداری‌شده دوباره به سبد اضافه نمی‌شود.
- routeهای `get-my-address` و `save-shipping-address` خواندن/ذخیره‌ی نشانی را انجام می‌دهند. تبدیل ارقام فارسی/عربی و اعتبارسنجی شماره/کدپستی و رفتار جایگزینی نشانی حفظ شده‌اند.
- `get-my-courses` و `check-course-access` از سفارش‌های `paid` به‌عنوان منبع حقیقت استفاده می‌کنند و شکل legacy پاسخ داشبورد را حفظ می‌کنند. همه‌ی این routeها server-only، `no-store` و با تست mock هستند.
- `apiCall` هفت endpoint بالا را به routeهای اختصاصی Next می‌فرستد و نامشان از allowlist پراکسی Edge حذف شده است. `payment-request` و `payment-verify` نیز order/cart را از PostgreSQL می‌خوانند/می‌نویسند؛ زرین‌پال سرویس بیرونی پرداخت است.

**گروه مدیریت (routeهای اختصاصی پیاده‌سازی‌شده در مخزن):**

- برای `admin-get-courses`، `admin-get-sessions`، `admin-users`، `admin-orders`، `admin-create-course`، `admin-update-course`، `admin-save-sessions`، `admin-overview`، `admin-upload-url` و `admin-shipments` routeهای Next ساخته شده و `apiCall` مستقیماً همان مسیرها را فراخوانی می‌کند.
- هر route مدیریتی نقش `admin` را با نشست PostgreSQL بررسی می‌کند؛ برنامه با role محدود DB اجرا می‌شود و پاسخ‌ها `no-store` هستند. قراردادهای پیشین و رفتارهای مدیریت سفارش/مرسوله در تست‌های mock پوشش دارند.
- `admin-upload-url` مدیر را در PostgreSQL احراز می‌کند و upload token محلی HMAC می‌سازد؛ فایل‌های تازه در volume محلی می‌روند. `admin-overview` و routeهای پرداخت از یک پیکربندی Zarinpal در environment سمت Next استفاده می‌کنند؛ در staging باید سندباکس باشد.
- هر ۱۰ نام بالا از allowlist پراکسی Edge حذف شده‌اند؛ درخواست مستقیم مرورگر به bridge برای این نام‌ها باید `404` بگیرد.

**هفت API که آخرین‌بار Edge-backed بودند — اکنون پیاده‌سازی‌شده در Next:**

- `POST /api/functions/get-course-file` و `get-course-sessions` نشست فعال و مالکیت سفارش `paid` را بررسی می‌کنند. فایل فقط با URL امضاشده‌ی پنج‌دقیقه‌ای داده می‌شود؛ لینک جلسه‌ی آنلاین هم فقط از پنج دقیقه پیش از زمان برنامه‌ریزی‌شده به پاسخ اضافه می‌شود.
- `POST /api/functions/send-otp` کد را hash‌شده در PostgreSQL ذخیره می‌کند، cooldown را اعمال می‌کند و sms.ir Verify/Bulk یا کاوه‌نگار را فراخوانی می‌کند. `POST /api/functions/otp-verify` expiry، تعداد تلاش و مصرف یک‌باره را با transaction کنترل می‌کند. در production بدون SMS provider درخواست با 503 بسته می‌شود و `debug_code` افشا نمی‌شود.
- `POST /api/functions/payment-request` قیمت را از دیتابیس می‌خواند، آدرس/اقلام فیزیکی را بررسی و سفارش می‌سازد؛ `payment-verify` تأیید زرین‌پال، پاک‌کردن سبد، ساخت مرسوله و پاسخ idempotent را انجام می‌دهد. هر دو route و کارت `admin-overview` از تنظیم‌های یکسان Zarinpal در environment Next استفاده می‌کنند.
- `GET /api/site-content` خواندن عمومی را انجام می‌دهد؛ `POST /api/functions/site-content` عملیات مدیر برای ذخیره/بازگردانی را با بررسی نشست و نقش admin اجرا می‌کند.
- نگاشت‌های مرورگر در `js/api.js` به routeهای هم‌مبدأ هستند؛ ابزار OTP تشخیصی نیز routeهای اختصاصی را صدا می‌زند. ترتیب ثبت‌نام تغییری نکرده است: ابتدا `otp-verify` و بعد `register-user`.
- allowlist پراکسی `/api/functions/[name]` خالی و fail-closed است؛ هیچ‌کدام از APIهای منتقل‌شده از آن عبور نمی‌کنند و درخواست مستقیم به نام‌های بالا 404 می‌گیرد. خود proxy انتقال backend نیست. نسخه‌های Edge در مخزن فقط به‌عنوان کد legacy/rollback باقی مانده‌اند.

تست‌های route با mock کار می‌کنند و آزمون staging با PostgreSQL، SMS یا زرین‌پال واقعی محسوب نمی‌شوند. Runtime self-hosted به Supabase وابسته نیست؛ توکن مرورگر هم فعلاً در `localStorage` باقی است.

**وضعیت گروه‌ها و ادامه‌ی مرحله‌ی ۳:**

1. **داده‌ی عمومی و اتصال‌های مستقیم — انجام‌شده در مخزن:** فهرست/جزئیات عمومی، خواندن محتوا و query مستقیم `admin.js` برای فهرست محصولات به مسیرهای Next منتقل شده‌اند.
2. **حساب و امنیت — انجام‌شده در مخزن:** ورود، ثبت‌نام، OTP، پروفایل، تغییر رمز، بررسی نشست و خروج در Next هستند. ترتیب ثبت‌نام اول `otp-verify` و بعد `register-user` است. انتقال `localStorage` به cookie امن طراحی جداگانه می‌خواهد.
3. **فروش — کد routeها انجام‌شده:** سبد، نشانی، فهرست دوره‌های خریداری‌شده، بررسی دسترسی و `payment-request`/`payment-verify` به PostgreSQL منتقل شده‌اند؛ آزمون sandbox/e2e و concurrency واقعی هنوز لازم است.
4. **مدیریت — کد routeها انجام‌شده:** ده route مدیریتی و read/write/reset `site_content` در PostgreSQL هستند؛ مجوز مدیر سمت سرور بررسی می‌شود و bootstrap واقعی/پنل staging هنوز باید آزموده شود.
5. **فایل و جلسه — کد routeها و Storage local انجام شده:** `admin-upload-url`، `get-course-file` و `get-course-sessions` از PostgreSQL و Storage محلی استفاده می‌کنند؛ volume/Nginx/restore واقعی هنوز validate نشده.
6. endpointهای Edge آزمایشی/تکراری مثل `admin-get-sessions-`، `chechout`، `test-add-purchase` و `sms-hook` حذف نشده‌اند. تا بررسی مصرف واقعی حذفشان نکنید؛ هیچ‌کدام در allowlist پراکسی فعلی نیستند.

**شرط عبور:** مسیرهای اصلی کاربر/مدیر در staging با endpointهای Next آزموده شده باشند، متغیرهای پیامک/پرداخت روی همان میزبان تنظیم باشند و هیچ secret یا query مدیریتی سمت مرورگر نباشد.

### مرحله‌ی ۴ — انتقال تدریجی صفحه‌ها به Next.js (اختیاری)

اگر هدف فقط خروج از Vercel است، صفحه‌های HTML می‌توانند با Nginx بمانند؛ این مرحله برای تبدیل کامل سایت به Next.js است.

1. صفحه‌های عمومی را ابتدا منتقل کنید: خانه، دوره‌ها، جزئیات دوره و درباره ما.
2. سپس صفحه‌های ورود/ثبت‌نام، سبد، داشبورد و صفحه‌های مدیر را منتقل کنید.
3. URLهای فعلی، query string شناسه‌ی دوره، `canonical`، `robots.txt`، `sitemap.xml`، JSON-LD، تصویرهای Open Graph، RTL و دسترس‌پذیری را حفظ کنید.
4. هر route جدید را با route قدیمی مقایسه کنید و فقط پس از قبولی سئو/رفتار کاربری مسیر قدیمی را حذف کنید.

**شرط عبور:** مسیرهای canonical فعلی و سناریوهای مرورگر حفظ شده باشند؛ صفحات خصوصی index نشوند.

### مرحله‌ی ۵ — جایگزینی Supabase Database با PostgreSQL مستقل

**وضعیت فعلی: کد مرحله‌ی ۵ برای همه‌ی routeهای فعال منتقل شده است.** inventory ساختاری ۱۱ جدول، constraintها، indexها، RLS/grantها، functionها و extensionها در [`docs/postgres-migration-inventory.md`](postgres-migration-inventory.md) ثبت شده؛ مبدأ PostgreSQL 17.6 است. دو function قدیمی trigger/policy فعالی ندارند و به مقصد منتقل نمی‌شوند. migration اولیه، pool/transaction helper با `pg` و runner نسخه‌بندی‌شده اضافه‌اند. ۳۱ handler function و دو GET در Next از PostgreSQL استفاده می‌کنند؛ Storage محلی است؛ Supabase SDK و secretهای Supabase از runtime حذف شده و allowlist Edge خالی است. کاربر تأیید کرده DB مقصد خالی باشد و انتقال داده‌ی قدیمی لازم نیست. اما schema اجرا نشده، Docker/PostgreSQL واقعی در sandbox موجود نیست و هیچ routeی به DB واقعی وصل نشده؛ بنابراین استقلال در کد پیاده شده ولی deploy هنوز مجاز نیست. Supabase قدیمی تا backup و rollback window روشن می‌ماند.

1. PostgreSQL خالی را از روی migration نسخه‌بندی‌شده‌ی مقصد بسازید و schema را بازبینی کنید؛ backup قدیمی فقط برای rollback است و مبنای restore در target نیست.
2. queryهای منتقل‌شده را با PostgreSQL واقعی، constraintها و role محدود تست کنید؛ endpointهای فعال دیگر از Supabase JS استفاده نمی‌کنند.
3. چون مقصد خالی خواهد بود، کاربران باید دوباره ثبت‌نام کنند و سفارش/نشست‌های قدیمی منتقل نمی‌شوند؛ این تصمیم را در متن/عملیات راه‌اندازی اعلام کنید. hash PBKDF2 در ثبت‌نام جدید با قالب قبلی تولید می‌شود.
4. روی staging disposable migration را از صفر اجرا کنید، first-admin بسازید، دوره/جلسه‌ی آزمایشی وارد کنید و رابطه‌های سفارش/خرید/مرسوله و مجوزها را تست کنید. Backup قدیمی برای rollback نگه داشته شود؛ آن را به مقصد import نکنید.
5. برای cutover نهایی maintenance تعیین کنید و نوشتن را موقتاً متوقف کنید. چون target خالی است، snapshot/delta قدیمی import نمی‌شود. تا پایان rollback window روزانه backup رمزگذاری‌شده از PostgreSQL و Storage مقصد بگیرید؛ روشن‌ماندن Supabase نسخه‌ی جدید را mirror نمی‌کند و rollback پس از ایجاد کاربر/سفارش جدید نیازمند reconcile جداگانه است.

**شرط عبور:** migration از صفر، تست auth/سفارش/دسترسی مدیر روی DB تازه، و backup/restore قابل‌بازیابی خارج از VPS موفق باشند. تطبیق row countهای دیتابیس قدیمی معیار پذیرش target نیست، چون داده‌ی قبلی عمداً منتقل نمی‌شود.

### مرحله‌ی ۶ — Storage محلی

کد این مرحله پیاده‌سازی شده است؛ bucketهای فعلی `course-files` و `course-images` بنا به گفته‌ی مالک خالی‌اند و انتقال فایل قدیمی انجام نمی‌شود.

- تصاویر JPEG/PNG/WebP/GIF با URL پایدار `/storage/course-images/...` از Nginx عمومی سرو می‌شوند؛ SVG ممنوع است.
- PDFهای `course-files` خصوصی‌اند؛ `get-course-file` نشست و سفارش paid را از PostgreSQL بررسی می‌کند و لینک دانلود HMAC پنج‌دقیقه‌ای صادر می‌کند.
- `admin-upload-url` مدیر را از PostgreSQL احراز و upload token محدود به bucket/path/MIME/اندازه صادر می‌کند. سقف کل پیش‌فرض 1 GiB است و volume دائمی Compose نگهداری می‌کند.
- تست filesystem موقت/mock موجود است؛ Docker volume، Nginx واقعی، concurrency/quota و backup/restore هنوز روی VPS آزمایش نشده‌اند.

**شرط عبور:** عکس‌ها نمایش داده شوند، مدیر بتواند بارگذاری کند، خریدار واقعی PDF را بگیرد، کاربر بدون خرید دسترسی نگیرد و لینک موقت پس از انقضا معتبر نباشد.

### مرحله‌ی ۷ — آزمون نهایی و تغییر DNS با دیتابیس خالی

1. روی staging از ابتدا تا انتها تست کنید: ثبت‌نام/OTP (کاربر جدید)، ورود/خروج، تغییر رمز، ساخت دوره/جلسه توسط مدیر، خرید دیجیتال و فیزیکی، زرین‌پال sandbox و callback، دانلود فایل، لینک جلسه‌ی زمان‌دار و پنل مدیر. هیچ ورود با حساب قدیمی روی DB تازه ممکن نیست؛ کاربران باید دوباره ثبت‌نام کنند.
2. برای staging اجازه‌ی پرداخت واقعی ندهید. در cutover از همان دامنه‌های فعلی و callback HTTPS ثبت‌شده استفاده کنید؛ secretهای live را فقط پس از قبولی sandbox وارد کنید.
3. پیش از cutover، TTL رکوردهای DNS را کاهش دهید. برنامه‌ی rollback و فرد مسئول تغییر DNS را مشخص کنید.
4. قبل از تغییر DNS پرداخت‌های درحال‌پرداخت در سیستم قدیمی را ببندید و تا settle/expire شدن‌شان صبر کنید. پرداخت pending قدیمی روی DB تازه رکورد ندارد و callback به نسخه‌ی جدید نمی‌تواند آن سفارش را تکمیل کند.
5. چون انتقال داده‌ی قدیمی در scope نیست، snapshot/delta به مقصد اعمال نمی‌شود. در یک پنجره‌ی maintenance، write/checkout قدیمی را ببندید، backup rollback بگیرید و DNS دامنه‌ی اصلی و زیردامنه‌ی مدیر را به VPS تغییر دهید.
6. بلافاصله health، صفحه‌ها، ثبت‌نام/ورود مدیر، ساخت دوره، خرید sandbox کنترل‌شده، callback، عکس‌ها و دانلود مجاز را بررسی کنید.

**محدودیت rollback:** روشن‌ماندن Supabase نسخه‌ی self-hosted را mirror نمی‌کند. پس از اولین write روی PostgreSQL جدید، rollback برنامه باید یا maintenance و انتقال/reconcile داده‌ی تازه به مقصد قبلی را داشته باشد، یا با پذیرش صریح از دست‌رفتن این writeها انجام شود؛ DNS rollback به‌تنهایی کافی نیست.

**شرط عبور:** سفارش قدیمی pending وجود نداشته باشد، کاربران از ثبت‌نام مجدد مطلع شده باشند، HTTPS/دامنه‌ها درست باشند و backup/restore/rollback واقعی تمرین شده باشد.

### مرحله‌ی ۸ — پایش و بازنشستگی سرویس‌های قبلی

1. چند روز/دوره‌ی پایشِ مورد توافق، خطاها، latency، پیامک، پرداخت، دیسک، backup و تمدید TLS را بررسی کنید.
2. Vercel و Supabase قبلی را در این بازه نگه دارید؛ کاربران/سفارش‌های قدیمی در آن نسخه می‌مانند، اما داده‌های تازه‌ی VPS را mirror نمی‌کند.
3. پس از موفقیت backup/restore مقصد و بسته‌شدن rollback window، یک export نهایی رمزگذاری‌شده نگه دارید و rollback را فقط با plan reconciliation خاموش کنید.
4. سپس hosting قبلی را لغو کنید؛ Supabase را فقط پس از اطمینان از نبود وابستگی، backup نهایی و خاتمه‌ی همه‌ی پرداخت‌های در جریان خاموش کنید.

## معیار نهایی cutover

- [ ] backup دیتابیس/Storage قدیمی برای rollback نگهداری و restore آن آزمایش شده؛ target تازه از صفر migrate شده است.
- [ ] bucketهای قدیمی بنا به اعلام مالک خالی‌اند؛ هیچ فایل قدیمی لازم برای انتقال باقی نمانده است.
- [ ] صفحه‌های عمومی، مسیرهای بدون `.html` و ریشه‌ی زیردامنه‌ی مدیر درست کار می‌کنند.
- [ ] ثبت‌نام مجدد کاربران از قبل اعلام شده؛ OTP و login روی PostgreSQL جدید کار می‌کند.
- [ ] checkout، callback زرین‌پال، idempotency سفارش و مدیریت پرداخت pending آزمایش شده‌اند.
- [ ] فایل خصوصی فقط به خریدار مجاز داده می‌شود و URL آن منقضی می‌شود.
- [ ] DNS، HTTPS، backup خارج از VPS، پایش و rollback آزمایش شده‌اند.
- [ ] Vercel/Supabase تا پایان دوره‌ی پایش خاموش نمی‌شوند.

## فایل‌های این مرحله

- [`deploy/self-hosted/README.md`](../deploy/self-hosted/README.md): اجرای آزمایشی Nginx/Docker و smoke testها.
- [`deploy/self-hosted/nginx.conf`](../deploy/self-hosted/nginx.conf): مسیرهای clean URL و زیردامنه‌ی مدیر.
- [`deploy/self-hosted/compose.yaml`](../deploy/self-hosted/compose.yaml): PostgreSQL، migration، Next.js، Nginx و volumeهای پایدار.
- [`deploy/self-hosted/bootstrap-ubuntu.sh`](../deploy/self-hosted/bootstrap-ubuntu.sh): نصب Docker روی Ubuntu 24.04 x86_64 در صورت نیاز و فراخوانی launcher.
- [`deploy/self-hosted/start.sh`](../deploy/self-hosted/start.sh): ساخت env در صورت نیاز، build/health-check و راه‌اندازی stack با یک فرمان.
- [`deploy/self-hosted/backup.sh`](../deploy/self-hosted/backup.sh) و [`restore.sh`](../deploy/self-hosted/restore.sh): backup رمزگذاری‌شده و restore تخریبی با gate تأیید.
- [`docs/deployment-readiness.md`](deployment-readiness.md): فهرست blockerها، پذیرش و اجرا.

**محدودیت و آخرین بررسی محلی (۱۷ اکتبر ۲۰۲۶):** نسخه‌ی self-hosted از نظر کد به Supabase runtime وابسته نیست؛ ۳۱ handler و دو GET به PostgreSQL منتقل شده‌اند و Storage محلی است. `cd tests && npm test` پس از افزودن smoke schema در PGlite/WASM موفق شد؛ migration پایه، ۱۱ جدول، role محدود، DML، UUID، trigger، constraintها و cascade اجرا/بررسی شدند. این WASM آزمون PostgreSQL server/شبکه‌ی واقعی نیست. `cd apps/next-app && npm test` نیز ۶۵/۶۵ موفق و `NEXT_TELEMETRY_DISABLED=1 npm run build` موفق بود. `python3 -m py_compile`، `sh -n` روی scriptهای deploy و `git diff --check` موفق‌اند؛ YAML مربوط به Compose و syntax scriptهای deploy parse شد؛ SEO injector آفلاین و تکرارپذیر است. `bootstrap-ubuntu.sh` برای نصب Docker روی Ubuntu 24.04 x86_64 و `start.sh` برای ساخت/اجرای stack با یک فرمان اضافه شد؛ وب روی loopback است و ingress/TLS عمومی در stack وجود ندارد. `shellcheck` و ابزارهای Docker/Compose، `psql` و `age` در sandbox موجود نیستند؛ DDL، role/init و Nginx در Docker واقعی، proxy/TLS بیرونی و backup/restore واقعی همچنان تأیید نشده‌اند. هیچ سرویس production یا DNS تغییر نکرده و backup زنده‌ی Supabase هنوز به دسترسی مالک نیاز دارد. مقصد داده‌ی خالی خواهد داشت؛ کاربران باید دوباره ثبت‌نام کنند. **Supabase قدیمی را تا backup و rollback window روشن نگه دارید؛ هنوز production cutover نکنید.**
