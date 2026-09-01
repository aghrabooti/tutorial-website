# راه‌اندازی پرداخت زرین‌پال (Payment Setup)

این سند مراحل لازم برای فعال‌سازی سیستم پرداخت را پوشش می‌دهد.
چهار قطعه اضافه شده است:

| قطعه | مسیر |
|---|---|
| ساخت سفارش و اتصال به درگاه | `supabase/functions/payment-request` |
| تأیید پرداخت و اعطای دوره‌ها | `supabase/functions/payment-verify` |
| صفحه‌ی بازگشت از درگاه | `frontend/pages/payment-result.html` + `frontend/js/payment-result.js` |
| اتصال دکمه‌ی «ادامه پرداخت» | `frontend/js/cart.js` |

---

## ۱) ساخت جدول سفارش‌ها

در Supabase → SQL Editor این کوئری را اجرا کنید:

```sql
create table if not exists public.orders (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null,
    authority   text unique,          -- null تا وقتی زرین‌پال جواب بدهد
    amount_rial bigint not null,
    description text,
    status      text not null default 'init',  -- init | pending | paid | failed
    source      text not null default 'cart',  -- cart | direct
    items       jsonb not null default '[]',   -- [{course_id, title, unit_price_rial}]
    course_ids  text[] not null default '{}',  -- برای کوئری مالکیت
    ref_id      bigint,
    card_pan    text,
    created_at  timestamptz not null default now(),
    verified_at timestamptz
);

-- سرویس‌رول RLS را دور می‌زند؛ برای بقیه کاملاً بسته است
alter table public.orders enable row level security;
```

اگر جدول را قبلاً ساخته‌اید، فقط ستون جدید را اضافه کنید:

```sql
alter table public.orders add column if not exists course_ids text[] not null default '{}';
```

> **مدل داده:** سفارشِ `paid` خودِِ سند خرید است — جدول جداگانه‌ای برای
> «خریدهای کاربر» وجود ندارد. توابع `check-course-access` و `get-my-courses`
> هم از همین جدول می‌خوانند.
>
> اگر قبل از این سیستم خریدهایی با جدول `purchases` ثبت شده‌اند و می‌خواهید
> حفظ شوند، یک‌بار این مهاجرت را اجرا کنید:

```sql
insert into public.orders
  (user_id, amount_rial, description, status, source, items, course_ids, created_at, verified_at)
select
  user_id::text, 0, 'انتقال خریدهای قبلی', 'paid', 'legacy',
  jsonb_build_array(jsonb_build_object('course_id', course_id)),
  array[course_id::text], now(), now()
from public.purchases;
```

---

## ۲) تنظیم Secret ها

```bash
# حالت تست (sandbox) — با هر UUID دلخواه کار می‌کند
supabase secrets set \
  ZARINPAL_MERCHANT_ID="00000000-0000-0000-0000-000000000000" \
  ZARINPAL_SANDBOX="true" \
  ZARINPAL_CALLBACK_URL="https://<دامنه‌ی-شما>/payment-result" \
  PRICE_TO_RIAL_FACTOR="10"

# حالت واقعی — بعد از دریافت مرچنت‌کد
supabase secrets set ZARINPAL_MERCHANT_ID="<مرچنت‌کد-۳۶-کاراکتری>" ZARINPAL_SANDBOX="false"
```

قوانین مهم:
- `ZARINPAL_MERCHANT_ID` را **هرگز** داخل کد یا ریپو نگذارید.
- `PRICE_TO_RIAL_FACTOR`: اگر `courses.price` به **تومان** ذخیره شده `10`، اگر ریال است `1`.
- `ZARINPAL_CALLBACK_URL` باید دقیقاً دامنه‌ی عمومی سایت + مسیر `/payment-result` باشد.

---

## ۳) دیپلوی فانکشن‌ها

```bash
supabase functions deploy payment-request
supabase functions deploy payment-verify
supabase functions deploy check-course-access
supabase functions deploy get-my-courses
```

⚠️ دو تابع آخر ممکن است قبلاً (خارج از ریپو) دیپلوی شده باشند — دیپلوی مجدد،
نسخه‌ی فعلی را با نسخه‌ی مبتنی‌بر `orders` جایگزین می‌کند. این همان تغییری است
که می‌خواهیم؛ کافی است هر ۴ تابع را یک‌بار دیپلوی کنید تا همه‌ی بخش‌ها روی
مدل تک‌جدولی کار کنند.

---

## ۴) تست در sandbox

1. در جدول `courses` یک دوره‌ی تست با قیمت پایین بسازید.
2. از سایت آن را به سبد خرید اضافه کرده و «ادامه پرداخت» را بزنید.
3. در صفحه‌ی sandbox زرین‌پال گزینه‌ی «پرداخت موفق» را انتخاب کنید.
4. باید به `/payment-result` برگردید، شماره پیگیری (ref_id) ببینید، و:
   - رکورد `orders` → `status = 'paid'`
   - رکورد جدید در جدول خریدها
   - سبد خرید خالی
5. سناریوهای منفی: دکمه‌ی «انصراف» (→ صفحه‌ی لغو)، رفرش صفحه‌ی نتیجه (بدون اعطای دوباره).

نکته: authority های sandbox با حرف `S` شروع می‌شوند.

---

## ۵) چک‌لیست «رفتن روی production»

- [ ] ثبت درخواست درگاه در `my.zarinpal.com` با دامنه‌ی سایت و تأیید حساب بانکی
- [ ] ست کردن مرچنت‌کد واقعی و `ZARINPAL_SANDBOX=false`
- [ ] تست یک خرید واقعی با مبلغ کم
- [ ] بررسی گزارش‌ها در پنل زرین‌پال (ref_id هر سفارش در جدول `orders` هم می‌ماند)

---

## ⚠️ نکته: نام جدول‌ها

تنها نام ثابتی که فانکشن‌های فعلی فرض می‌کنند جدول سبد خرید است:

```ts
const CART_TABLE = "cart_items";   // با ستون‌های user_id و course_id
```

اگر نام واقعی فرق دارد، همین خط را در **هر سه** فانکشن `payment-request`،
`payment-verify` و (در صورت نیاز) توابع کارت اصلاح کنید.
جدول `orders` برای همه توسط همین پکیج ساخته می‌شود و فرضی درباره‌ی
جدول خرید مجزایی وجود ندارد (مدل تک‌جدولی).
