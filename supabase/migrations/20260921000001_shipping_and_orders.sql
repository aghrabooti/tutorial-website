-- ─────────────────────────────────────────────────────────────────────────────
-- مهاجرت ایمن و idempotent: مرسوله‌های پستی، نشانی کاربران و سفارش‌ها
--
-- این فایل چند بار هم اجرا شود بی‌خطر است و چیزی را حذف نمی‌کند.
-- اجرای خودکار: GitHub → Actions → «Deploy Supabase Edge Functions» → Run workflow
--   (ورودی migrate_database روی true باشد)
-- اجرای دستی: Supabase → SQL Editor → کل این متن را اجرا کنید.
--
-- هدف: تضمین این‌که خرید کتاب/جزوه همیشه در تب «مرسوله‌های پستی» پنل مدیر
--       دیده شود (نه صرفاً برای خریدهای جدید، بلکه برای خریدهای قبلی هم).
-- ─────────────────────────────────────────────────────────────────────────────

-- ۱) جدول مرسوله‌های پستی -------------------------------------------------------
create table if not exists public.shipments (
    id            uuid primary key default gen_random_uuid(),
    order_id      uuid,
    user_id       text,
    full_name     text,
    phone         text,
    province      text,
    city          text,
    address       text,
    postal_code   text,
    status        text not null default 'pending',   -- pending | sent
    tracking_code text,
    sent_at       timestamptz,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

-- ستون‌های احتمالیِ جامانده (اگر جدول قبلاً ساخته شده باشد)
alter table public.shipments add column if not exists order_id      uuid;
alter table public.shipments add column if not exists user_id       text;
alter table public.shipments add column if not exists full_name     text;
alter table public.shipments add column if not exists phone         text;
alter table public.shipments add column if not exists province      text;
alter table public.shipments add column if not exists city          text;
alter table public.shipments add column if not exists address       text;
alter table public.shipments add column if not exists postal_code   text;
alter table public.shipments add column if not exists status        text not null default 'pending';
alter table public.shipments add column if not exists tracking_code text;
alter table public.shipments add column if not exists sent_at       timestamptz;
alter table public.shipments add column if not exists created_at    timestamptz not null default now();
alter table public.shipments add column if not exists updated_at    timestamptz not null default now();

-- رکوردهای قدیمی که status ندارند/خالی‌اند → pending
update public.shipments set status = 'pending' where status is null;

create index if not exists shipments_status_idx   on public.shipments (status);
create index if not exists shipments_created_idx  on public.shipments (created_at desc);
create index if not exists shipments_order_idx    on public.shipments (order_id);

-- یکتا بودن order_id برای هر مرسوله؛ فقط اگر داده‌ی تکراری وجود نداشته باشد
-- (کد تابع دیگر به این constraint وابسته نیست، ولی از ساخت رکورد تکراری
--  در شرایط هم‌زمانی جلوگیری می‌کند)
do $$
begin
    if not exists (
        select 1 from pg_indexes
        where schemaname = 'public' and indexname = 'shipments_order_id_key'
    ) and not exists (
        select 1 from public.shipments
        where order_id is not null
        group by order_id
        having count(*) > 1
    ) then
        create unique index shipments_order_id_key on public.shipments (order_id);
    end if;
end $$;

-- فقط سرویس‌رول به این جدول دسترسی دارد (فانکشن‌ها با service role کار می‌کنند)
alter table public.shipments enable row level security;

-- ۲) نشانی پستی کاربران ---------------------------------------------------------
create table if not exists public.user_addresses (
    user_id     text primary key,
    full_name   text,
    phone       text,
    province    text,
    city        text,
    address     text,
    postal_code text,
    updated_at  timestamptz default now()
);

alter table public.user_addresses add column if not exists full_name   text;
alter table public.user_addresses add column if not exists phone       text;
alter table public.user_addresses add column if not exists province    text;
alter table public.user_addresses add column if not exists city        text;
alter table public.user_addresses add column if not exists address     text;
alter table public.user_addresses add column if not exists postal_code text;
alter table public.user_addresses add column if not exists updated_at  timestamptz default now();

-- یک نشانی برای هر کاربر (تابع ذخیره‌سازی هم دیگر به این constraint تکیه نمی‌کند)
do $$
begin
    if not exists (
        select 1 from pg_indexes
        where schemaname = 'public' and indexname = 'user_addresses_user_id_key'
    ) and not exists (
        select 1 from public.user_addresses
        group by user_id
        having count(*) > 1
    ) then
        create unique index user_addresses_user_id_key on public.user_addresses (user_id);
    end if;
end $$;

alter table public.user_addresses enable row level security;

-- ۳) ستون‌های سفارش‌ها (برای خریدهای قدیمی) --------------------------------------
create table if not exists public.orders (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null,
    authority   text unique,
    amount_rial bigint not null default 0,
    description text,
    status      text not null default 'init',
    source      text not null default 'cart',
    items       jsonb not null default '[]',
    course_ids  text[] not null default '{}',
    ref_id      bigint,
    card_pan    text,
    created_at  timestamptz not null default now(),
    verified_at timestamptz
);

alter table public.orders add column if not exists course_ids  text[] not null default '{}';
alter table public.orders add column if not exists source      text not null default 'cart';
alter table public.orders add column if not exists items       jsonb not null default '[]';
alter table public.orders add column if not exists card_pan    text;
alter table public.orders add column if not exists verified_at timestamptz;

create index if not exists orders_status_idx  on public.orders (status);
create index if not exists orders_user_idx    on public.orders (user_id);
create index if not exists orders_created_idx on public.orders (created_at desc);

alter table public.orders enable row level security;

-- ۴) ستون requires_shipping محصولات ---------------------------------------------
-- (product type = book/lecture هم پستی محسوب می‌شود؛ این ستون برای سازگاری است)
alter table public.courses add column if not exists requires_shipping boolean default false;

update public.courses
   set requires_shipping = true
 where requires_shipping is distinct from true
   and type in ('book', 'lecture');

-- ۵) گزارش نهایی (در لاگ اجرا دیده می‌شود) ---------------------------------------
do $$
declare
    v_orders     bigint;
    v_paid_phys  bigint;
    v_shipments  bigint;
    v_missing    bigint;
begin
    select count(*) into v_orders from public.orders where status = 'paid';

    select count(distinct o.id) into v_paid_phys
      from public.orders o
     where o.status = 'paid'
       and (
            exists (
                select 1 from jsonb_array_elements(o.items) it
                where (it->>'requires_shipping')::boolean is true
            )
            or exists (
                select 1 from public.courses c
                where c.id::text = any (o.course_ids)
                  and (c.requires_shipping is true or c.type in ('book', 'lecture'))
            )
       );

    select count(*) into v_shipments from public.shipments;

    select count(*) into v_missing
      from public.orders o
     where o.status = 'paid'
       and (
            exists (
                select 1 from jsonb_array_elements(o.items) it
                where (it->>'requires_shipping')::boolean is true
            )
            or exists (
                select 1 from public.courses c
                where c.id::text = any (o.course_ids)
                  and (c.requires_shipping is true or c.type in ('book', 'lecture'))
            )
       )
       and not exists (
            select 1 from public.shipments s where s.order_id = o.id
       );

    raise notice 'سفارش‌های موفق: %, سفارش‌های پستی: %, مرسوله‌ها: %, بدون مرسوله: %',
        v_orders, v_paid_phys, v_shipments, v_missing;
end $$;
