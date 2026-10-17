# اجرای آزمایشی نسخه‌ی self-hosted

> **وضعیت فعلی: کد runtime دیگر به Supabase وابسته نیست و launcher یک‌فرمانی آماده شده، اما اجرای واقعی روی VPS هنوز تأیید نشده است.** ۳۱ handler API به PostgreSQL منتقل شده‌اند و Storage محلی است. `start.sh` stack را می‌سازد/بالا می‌آورد و وب را فقط روی `127.0.0.1:8080` در host در دسترس می‌گذارد. reverse proxy عمومی و TLS در این مخزن بسته‌بندی نشده‌اند و برای شروع stack لازم نیستند؛ برای دسترسی عمومی باید از proxy موجود روی VPS/provider استفاده شود. Compose با PostgreSQL/Docker واقعی، پرداخت sandbox، backup/restore و browser flow هنوز در این محیط اجرا نشده‌اند. تا عبور از معیارهای staging، DNS اصلی را تغییر ندهید و Supabase قدیمی را برای rollback روشن نگه دارید.
>
> فهرست کامل blockerها و معیار عبور در [`docs/deployment-readiness.md`](../../docs/deployment-readiness.md) است.

## سرویس‌های Compose

- **`db`**: PostgreSQL شاخه‌ی 17، فقط روی شبکه‌ی داخلی Compose؛ 5432 به host منتشر نمی‌شود. داده در volume پایدار `postgres-data` می‌ماند.
- **`migrate`**: پس از healthy شدن DB، migrationهای نسخه‌بندی‌شده را یک‌بار اجرا می‌کند. فقط این سرویس URL مدیر دیتابیس را می‌گیرد.
- **`storage-init`**: volume ذخیره‌سازی را برای UID/GID ثابت `1001` آماده می‌کند.
- **`next-app`**: Next.js روی Node 22؛ به نقش محدود برنامه در PostgreSQL و volume فایل‌ها متصل است. healthcheck آن هم اتصال به جدول‌های پایه و هم امکان نوشتن روی Storage را بررسی می‌کند.
- **`web`**: Nginx برای HTML/CSS/JS و reverse proxy API. فقط روی `127.0.0.1:8080` در VPS bind می‌شود. عکس‌های `course-images` را از volume محلی سرو می‌کند؛ `course-files` خصوصی است و Nginx آن را سرو نمی‌کند.
- **ورودی عمومی**: این Compose reverse proxy عمومی یا TLS را بسته‌بندی نمی‌کند. سرویس `web` فقط روی `127.0.0.1:8080` در host منتشر می‌شود؛ برای دسترسی عمومی، reverse proxy موجود روی VPS/provider را جداگانه به همین آدرس وصل کنید.

سرویس `migrate` وابستگی `next-app` است؛ اگر DB بالا نیاید یا migration شکست بخورد، Next به‌عنوان سرویس healthy بالا نمی‌آید. PostgreSQL فقط از داخل Docker یا از طریق SSH tunnel مدیریت شود.

## راه‌اندازی یک‌فرمانی روی VPS

پس از بارگذاری **کل مخزن** روی Ubuntu 24.04 x86_64، این دستور را در ترمینال VPS اجرا کنید. روی سرور تازه، Docker Engine/Compose v2 را از مخزن رسمی Docker نصب و سپس stack را build/start می‌کند؛ اگر Docker از قبل نصب باشد، از نصب دوباره صرف‌نظر می‌کند:

```bash
sudo env CREATE_INITIAL_ADMIN=1 bash deploy/self-hosted/bootstrap-ubuntu.sh
```

این دستور DNS فعلی را تغییر نمی‌دهد و پورت عمومی باز نمی‌کند؛ وب فقط روی `127.0.0.1:8080` گوش می‌دهد. برای smoke test خصوصی از SSH tunnel استفاده کنید. اگر `.env` وجود نداشته باشد، launcher آن را با رمزهای تصادفی می‌سازد، مجوزش را محدود می‌کند، Compose را اعتبارسنجی می‌کند، imageها را می‌سازد و پس از healthy شدن DB/migration/Storage سرویس‌ها را بالا می‌آورد. `CREATE_INITIAL_ADMIN=1` مدیر اولیه را از TTY می‌سازد و رمز را بدون نمایش می‌گیرد. این نصب از `sudo` استفاده می‌کند؛ `.env` را بعداً با دسترسی root ویرایش کنید. راه‌اندازی stack به DNS عمومی یا TLS وابسته نیست.

**فقط پس از عبور از gateهای backup/restore و تصمیم cutover**، DNS دامنه‌های فعلی را به VPS ببرید و reverse proxy موجود روی VPS/provider را برای ارسال درخواست‌های دامنه به `http://127.0.0.1:8080` تنظیم کنید. TLS، اگر در مسیر عمومی استفاده می‌شود، باید همان‌جا مدیریت و جداگانه validate شود؛ این repository آن را نصب یا پیکربندی نمی‌کند و برای اجرای stack لازم نیست. راه‌اندازی مجدد پس از تنظیم `.env` همان فرمان قبلی است:

```bash
sudo env CREATE_INITIAL_ADMIN=1 bash deploy/self-hosted/bootstrap-ubuntu.sh
```

اگر مدیر قبلاً روی همین دیتابیس ساخته شده است `CREATE_INITIAL_ADMIN=1` را حذف کنید؛ وگرنه bootstrap تعاملی دوباره اجرا می‌شود. این فرمان DNS و firewall را تغییر نمی‌دهد. کلیدهای SMS/Zarinpal خودکار ساخته نمی‌شوند؛ اگر خالی باشند سایت بالا می‌آید، اما OTP/پرداخت کار نمی‌کند. callback زرین‌پال را برای دامنه‌ی فعلی و محیط sandbox/production تنظیم کنید. می‌توانید `.env` را پیش از اجرا بسازید/ویرایش کنید؛ بعد از ویرایش همین bootstrap را دوباره اجرا کنید.

اگر Docker از قبل نصب است، می‌توانید مستقیماً `./deploy/self-hosted/start.sh` را اجرا کنید. برای public access، reverse proxy موجود روی میزبان/provider را جداگانه طوری تنظیم کنید که دامنه‌های ثابت را به `127.0.0.1:8080` بفرستد؛ این stack مالک پورت‌های 80/443 نیست.

**این راه‌اندازی هنوز روی VPS واقعی آزمایش نشده است.** DNS فعلی را تا تکمیل آزمون، backup و rollback window تغییر ندهید و Supabase قدیمی را خاموش نکنید.

## ساخت فایل محیطی امن

پیش‌نیازهای میزبان: Docker Engine + Docker Compose plugin و OpenSSL. از ریشه‌ی مخزن:

```bash
./deploy/self-hosted/create-env.sh
chmod 600 .env
```

اسکریپت `.env` موجود را بازنویسی نمی‌کند و سه مقدار تصادفیِ DB admin، کاربر برنامه و امضای Storage می‌سازد. رمزها hex هستند تا در URL دیتابیس نیاز به percent-encoding نداشته باشند. فایل `.env` را commit یا در چت/لاگ عمومی قرار ندهید.

در `.env` فقط تنظیم‌های بیرونیِ لازم برای آزمون را اضافه کنید:

- SMS: یکی از `SMS_IR_API_KEY` به‌همراه template/line مناسب یا `KAVENEGAR_API_KEY`. `OTP_DEBUG=false` بماند.
- پرداخت: فعلاً فقط Zarinpal sandbox؛ مرچنت تست و callback باید متعلق به staging باشد. تا عبور کامل تست‌ها از مرچنت واقعی استفاده نکنید.
- Runtime self-hosted به Supabase URL/keys نیاز ندارد؛ APIها برای داده از PostgreSQL، فایل‌ها از volume محلی و پرداخت/پیامک از سرویس‌های بیرونی استفاده می‌کنند. نسخه‌ی قدیمی Vercel/Supabase را تا پایان rollback window دست‌نخورده نگه دارید.

قبل از استفاده، فایل محیطی را بدون چاپ secretها بررسی کنید:

```bash
docker compose --env-file .env -f deploy/self-hosted/compose.yaml config --quiet
```

## اجرای staging تازه

برای اجرای فقط روی پورت loopback و بدون درخواست TLS عمومی (مثلاً روی staging disposable)، از ریشه‌ی مخزن اجرا کنید:

```bash
./deploy/self-hosted/start.sh
```

دستورهای Compose خام زیر برای کنترل دستی build/log نگه داشته شده‌اند؛ با `.env` ساخته‌شده:

```bash
docker compose --env-file .env -f deploy/self-hosted/compose.yaml build
docker compose --env-file .env -f deploy/self-hosted/compose.yaml up -d
docker compose --env-file .env -f deploy/self-hosted/compose.yaml ps
```

روی volume تازه، schema پایه ساخته و migrationها اعمال می‌شوند. این DDL هنوز در sandbox با Docker/PostgreSQL واقعی اجرا نشده است؛ اجرای نخست را روی staging disposable انجام دهید و logهای migration را بررسی کنید. برای restart عادی از `down` بدون `-v` استفاده کنید؛ حذف volume دیتابیس یا Storage داده‌های تازه را پاک می‌کند.

```bash
docker compose --env-file .env -f deploy/self-hosted/compose.yaml logs --tail=100 db migrate next-app web
```

`GET /api/health` فقط liveness است. `GET /api/health/ready` اتصال PostgreSQL، وجود جدول‌های پایه و نوشتن آزمایشی در volume Storage را بررسی می‌کند.

## ساخت مدیر اولیه

بعد از اجرای موفق migration، روی TTY تعاملی VPS:

```bash
docker compose --env-file .env -f deploy/self-hosted/compose.yaml exec -it next-app \
  node --conditions=react-server scripts/create-admin.js
```

اسکریپت شماره و رمز را به‌صورت تعاملی می‌گیرد؛ رمز روی ترمینال نمایش داده نمی‌شود، حداقل ۱۲ نویسه است و فقط اگر هیچ مدیر/شماره‌ی تکراری نباشد یک حساب admin می‌سازد. آن را از طریق shell غیرتعاملی اجرا نکنید. همه‌ی routeهای مدیریت اکنون به PostgreSQL منتقل شده‌اند، اما پنل مرورگر و سناریوی مدیر تا آزمون end-to-end روی staging تأییدشده محسوب نمی‌شوند.

## آزمون smoke محلی روی همان VPS

```bash
curl -sS -o /dev/null -w 'main: %{http_code}\n' \
  -H 'Host: mahdiazizi.com' http://127.0.0.1:8080/

curl -sS -o /dev/null -w 'courses: %{http_code}\n' \
  -H 'Host: mahdiazizi.com' http://127.0.0.1:8080/courses

curl -sS -o /dev/null -w 'component: %{http_code}\n' \
  -H 'Host: mahdiazizi.com' http://127.0.0.1:8080/components/header.html

curl -sS -D - -o /dev/null \
  -H 'Host: admin.mahdiazizi.com' http://127.0.0.1:8080/

curl -fsS -H 'Host: mahdiazizi.com' http://127.0.0.1:8080/api/health
curl -fsS -H 'Host: mahdiazizi.com' http://127.0.0.1:8080/api/health/ready
```

انتظار: فایل‌های وب `200`، ریشه‌ی زیردامنه‌ی مدیر `302` به `/admin-login`، liveness پاسخ `{"status":"ok","service":"next-api"}` و readiness پاسخ `{"status":"ready",...}`. `/api/courses` از PostgreSQL مستقل می‌خواند، اما دیتابیس تازه عمداً خالی است و تا ساخت دوره از پنل، آرایه‌ی دوره‌ها خالی می‌ماند. این smoke جایگزین flow کامل و آزمون staging نیست.

## انتقال فایل در کد

- آپلود با توکن HMAC محدود به bucket/path/حجم و اعتبار پنج‌دقیقه‌ای انجام می‌شود؛ توکن در header `Authorization` است، نه query string.
- تصاویر فقط JPEG/PNG/WebP/GIF هستند و از مسیر عمومی `/storage/course-images/...` سرو می‌شوند. SVG عمداً مجاز نیست.
- PDFها با سقف هر فایل 100 MiB در `course-files` خصوصی نوشته می‌شوند و فقط با URL موقت پنج‌دقیقه‌ای از route دانلود stream می‌شوند؛ پیش از صدور URL، نشست و مالکیت سفارش `paid` از PostgreSQL بررسی می‌شود.
- سقف کل Storage به‌صورت پیش‌فرض 1 GiB است (`STORAGE_MAX_BYTES`). یک نمونه‌ی `next-app` باید اجرا شود تا قفل quota داخل فرایند بین uploadها معتبر بماند.
- این مسیرها با تست filesystem موقت/mock بررسی شده‌اند، نه با Docker volume، Nginx واقعی یا VPS. پیش از production به آزمون concurrency، فضای دیسک و restore نیاز دارند.

## Reverse proxy و دامنه

Stack پورت عمومی publish نمی‌کند و reverse proxy/TLS را نصب یا مدیریت نمی‌کند؛ `web` فقط روی `127.0.0.1:8080` در host در دسترس است. این برای build، start و smoke test خصوصی کافی است. برای دسترسی عمومی، reverse proxy موجود روی VPS/provider را جداگانه برای دامنه‌های ثابت `mahdiazizi.com`، `www.mahdiazizi.com` و `admin.mahdiazizi.com` به `http://127.0.0.1:8080` وصل کنید؛ نام دامنه‌ها را تغییر ندهید. TLS termination خارج از این repository است و مانع اجرای stack نیست، اما باید پیش از production و callback پرداخت جداگانه بررسی شود. پورت PostgreSQL (`5432`) و پورت داخلی برنامه (`3000`) به host منتشر نمی‌شوند.

تا staging، backup/restore و rollback کامل نشده DNS اصلی را تغییر ندهید. اگر staging عمومی است، در reverse proxy موجود Basic Auth/IP allowlist بگذارید و indexing را ببندید.

Nginx برای آپلود PDF تا 105 MiB body را stream می‌کند و route دانلود را از access log پیش‌فرض پنهان می‌کند چون URL آن token کوتاه‌عمر دارد. مسیر `/storage/course-files/` عمداً 404 می‌دهد.

## Backup، restore و rollback

اسکریپت‌های `backup.sh` و `restore.sh` برای PostgreSQL و volume فایل‌ها اضافه شده‌اند؛ برای encryption از `age` استفاده می‌کنند. `age` را از منبع مورداعتماد روی VPS نصب کنید. کلید خصوصی age را خارج از VPS نگه دارید و فقط public recipient را در اجرای backup بدهید.

```bash
BACKUP_DIR=/mnt/offsite/tutorial \\
BACKUP_AGE_RECIPIENT='age1...' \\
BACKUP_KEEP_DAYS=30 \\
  ./deploy/self-hosted/backup.sh
```

`BACKUP_DIR` باید بیرون repository و ترجیحاً mount/مسیر replicate‌شده به provider یا region جدا از VPS باشد. خود اسکریپت فایل رمزگذاری‌شده و checksum می‌سازد، اما انتقال offsite و schedule را نصب نمی‌کند؛ برای production هنوز باید sync/scheduler و alert راه‌اندازی کنید.

Restore تمام DB و Storage مقصد را **جایگزین** می‌کند؛ ابتدا فایل‌ها و checksum را کنترل کنید، maintenance بگذارید و فقط روی staging تمرین کنید:

```bash
RESTORE_CONFIRM=OVERWRITE_CURRENT_DATABASE_AND_STORAGE \\
BACKUP_DB_FILE=/mnt/offsite/tutorial/tutorial-db-....dump.age \\
BACKUP_STORAGE_FILE=/mnt/offsite/tutorial/tutorial-storage-....tar.gz.age \\
BACKUP_MANIFEST=/mnt/offsite/tutorial/tutorial-....sha256 \\
BACKUP_AGE_IDENTITY=/secure/path/age-identity.txt \\
  ./deploy/self-hosted/restore.sh
```

اسکریپت قبل از restore برنامه را متوقف می‌کند؛ کلید private age روی VPS لازم می‌شود، پس آن را پس از restore امن بردارید. DB و Storage در دو archive جدا هستند و restore آن‌ها یک transaction مشترک نیست؛ اگر یکی شکست خورد، ترافیک را باز نکنید و بازیابی را کامل کنید.

- `docker compose down` کانتینرها را متوقف می‌کند و volumeها را حذف نمی‌کند.
- از `docker compose down -v`، `docker volume rm` یا reset کردن volume در production استفاده نکنید.
- backup و restore scriptها در این محیط با Docker/age واقعی اجرا نشده‌اند؛ تا restore drill، offsite copy و rollback DNS/image آزمایش نشده، **هیچ cutover production مجاز نیست**.
- Supabase و سرویس قبلی باید تا پایان backup/restore/rollback و دوره‌ی پایش روشن بمانند، حتی اگر دیتابیس مقصد از صفر شروع شود.

## تست‌های محلی

```bash
cd apps/next-app
npm ci
npm test
NEXT_TELEMETRY_DISABLED=1 npm run build
```

در این sandbox Docker، Compose و `psql` نصب نیست؛ build image، اجرای DDL واقعی و smoke test روی VPS را نتوانستم اجرا/تأیید کنم. موفقیت unit-test و build جایگزین این بررسی‌ها نیست.
