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
    ref_id      bigint,
    card_pan    text,
    created_at  timestamptz not null default now(),
    verified_at timestamptz
);

-- سرویس‌رول RLS را دور می‌زند؛ برای بقیه کاملاً بسته است
alter table public.orders enable row level security;
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
```

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

تابع‌های `get-cart` و `check-course-access` در ریپو نیستند، پس نام پیش‌فرض زیر
در بالای هر دو فانکشن به‌صورت ثابت تعریف شده است:

```ts
const CART_TABLE      = "cart_items";
const PURCHASES_TABLE = "purchases";
```

اگر نام‌های واقعی متفاوت‌اند، فقط همین دو خط را در **هر دو** فانکشن اصلاح کنید.
پ.ن: `payment-verify` به ساختار `cart_items(user_id, course_id)` و
`purchases(user_id, course_id)` فرض می‌کند.
